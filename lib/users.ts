import "server-only";
import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { getAuthConfig } from "./auth/config";

/**
 * Sign-in accounts for customer users, in the Cognito user pool. A user
 * belongs to a customer through the custom:customer_id attribute, which is
 * what the dashboard reads from their ID token.
 *
 * The server's own AWS role needs the matching cognito-idp permissions
 * (infra/iam/ctm365-dashboard-ec2-role.cognito-user-admin.json).
 */

const ADMIN_GROUP = "Admins";
const CUSTOMER_GROUP = "Customers";

let client: CognitoIdentityProviderClient | undefined;

function getClient() {
  client ??= new CognitoIdentityProviderClient({ region: getAuthConfig().region });
  return client;
}

function poolId() {
  return getAuthConfig().userPoolId;
}

export type UserState = "active" | "invited" | "invite-expired" | "other";

export interface CustomerUser {
  /** Cognito's internal username (the user's sub). Stable even if the email changes. */
  username: string;
  email: string;
  state: UserState;
  enabled: boolean;
  isAdmin: boolean;
  createdAt: string | null;
}

/** A problem whose message is safe to show to the admin. */
export class UserAdminError extends Error {
  name = "UserAdminError";
}

const attr = (attrs: AttributeType[] | undefined, name: string) => attrs?.find((a) => a.Name === name)?.Value;

function stateFor(status: string | undefined, created: Date | undefined): UserState {
  if (status === "CONFIRMED") return "active";
  if (status === "FORCE_CHANGE_PASSWORD") {
    // Temporary passwords last 7 days in this pool; after that the invite has to be resent.
    const ageDays = created ? (Date.now() - created.getTime()) / 86_400_000 : 0;
    return ageDays > 7 ? "invite-expired" : "invited";
  }
  return "other";
}

async function adminUsernames(): Promise<Set<string>> {
  const names = new Set<string>();
  let token: string | undefined;
  do {
    const out = await getClient().send(
      new ListUsersInGroupCommand({ UserPoolId: poolId(), GroupName: ADMIN_GROUP, NextToken: token }),
    );
    for (const u of out.Users ?? []) if (u.Username) names.add(u.Username);
    token = out.NextToken;
  } while (token);
  return names;
}

/**
 * Users linked to this customer, newest first. Cognito can't filter on
 * custom attributes, so this lists the pool and filters here; fine into the
 * thousands of users.
 */
export async function listCustomerUsers(customerId: string): Promise<CustomerUser[]> {
  const [admins, users] = await Promise.all([adminUsernames(), listAllUsers()]);
  return users
    .filter((u) => attr(u.Attributes, "custom:customer_id") === customerId)
    .map((u) => ({
      username: u.Username!,
      email: attr(u.Attributes, "email") ?? "(no email)",
      state: stateFor(u.UserStatus, u.UserCreateDate),
      enabled: u.Enabled !== false,
      isAdmin: admins.has(u.Username!),
      createdAt: u.UserCreateDate?.toISOString() ?? null,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

async function listAllUsers() {
  const users = [];
  let token: string | undefined;
  do {
    const out = await getClient().send(new ListUsersCommand({ UserPoolId: poolId(), PaginationToken: token, Limit: 60 }));
    users.push(...(out.Users ?? []));
    token = out.PaginationToken;
  } while (token);
  return users;
}

/**
 * Creates the account and has Cognito email a temporary password. The user
 * sets their own password at first sign-in.
 */
export async function inviteUser(customerId: string, email: string): Promise<void> {
  try {
    const out = await getClient().send(
      new AdminCreateUserCommand({
        UserPoolId: poolId(),
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "custom:customer_id", Value: customerId },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
    const username = out.User?.Username;
    if (username) {
      await getClient().send(
        new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: username, GroupName: CUSTOMER_GROUP }),
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === "UsernameExistsException") {
      const other = await customerIdOf(email).catch(() => undefined);
      throw new UserAdminError(
        other === customerId
          ? `${email} already has an account for this customer.`
          : `${email} already has an account${other ? ` for another customer ("${other}")` : ""}.`,
      );
    }
    throw err;
  }
}

async function customerIdOf(username: string): Promise<string | undefined> {
  const out = await getClient().send(new AdminGetUserCommand({ UserPoolId: poolId(), Username: username }));
  return attr(out.UserAttributes, "custom:customer_id");
}

/** Throws unless the user exists and belongs to this customer, so an action can't reach another customer's users. */
async function assertBelongs(customerId: string, username: string) {
  let owner: string | undefined;
  try {
    owner = await customerIdOf(username);
  } catch (err) {
    if (err instanceof Error && err.name === "UserNotFoundException") {
      throw new UserAdminError("That user no longer exists. Reload the page.");
    }
    throw err;
  }
  if (owner !== customerId) throw new UserAdminError("That user doesn't belong to this customer. Reload the page.");
}

/** Emails a new temporary password. Only works for users who haven't signed in yet. */
export async function resendInvite(customerId: string, username: string): Promise<void> {
  await assertBelongs(customerId, username);
  await getClient().send(
    new AdminCreateUserCommand({
      UserPoolId: poolId(),
      Username: username,
      MessageAction: "RESEND",
      DesiredDeliveryMediums: ["EMAIL"],
    }),
  );
}

/** A disabled user can't sign in; their account and settings are kept. */
export async function setUserEnabled(customerId: string, username: string, enabled: boolean): Promise<void> {
  await assertBelongs(customerId, username);
  const input = { UserPoolId: poolId(), Username: username };
  await getClient().send(enabled ? new AdminEnableUserCommand(input) : new AdminDisableUserCommand(input));
}

/** Permanently deletes the sign-in account. Cognito can't restore it. */
export async function deleteUser(customerId: string, username: string): Promise<void> {
  await assertBelongs(customerId, username);
  await getClient().send(new AdminDeleteUserCommand({ UserPoolId: poolId(), Username: username }));
}

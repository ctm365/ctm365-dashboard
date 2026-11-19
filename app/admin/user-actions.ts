"use server";

import { requireAdminAction } from "@/lib/auth/session";
import { ConfigInputError, parseCustomerId, parseEmail } from "@/lib/config/validation";
import {
  deleteUser,
  inviteUser,
  listCustomerUsers,
  resendInvite,
  setUserEnabled,
  UserAdminError,
  type CustomerUser,
} from "@/lib/users";

/**
 * Admin-only actions on a customer's sign-in accounts. Each one checks the
 * admin first, then (in lib/users) that the target user belongs to this
 * customer. Results come back as values: Next.js hides thrown messages.
 */

export type UsersResult = { ok: true; users: CustomerUser[] } | { ok: false; error: string };

function failure(operation: string, err: unknown): UsersResult {
  if (err instanceof ConfigInputError || err instanceof UserAdminError) return { ok: false, error: err.message };
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[admin-users] ${operation} failed: ${name}: ${err instanceof Error ? err.message : String(err)}`);
  if (name === "AccessDeniedException" || name === "NotAuthorizedException") {
    return { ok: false, error: "The server isn't allowed to manage sign-in accounts. Check its AWS permissions." };
  }
  if (name === "LimitExceededException" || name === "TooManyRequestsException") {
    return { ok: false, error: "Too many emails or requests right now. Try again in a few minutes." };
  }
  if (name === "UnsupportedUserStateException") {
    return { ok: false, error: "This user has already signed in, so there's no invite to resend." };
  }
  return { ok: false, error: "Couldn't complete that. Please try again." };
}

async function run(
  operation: string,
  rawCustomerId: unknown,
  action: (customerId: string) => Promise<void>,
): Promise<UsersResult> {
  try {
    const customerId = parseCustomerId(rawCustomerId);
    await action(customerId);
    return { ok: true, users: await listCustomerUsers(customerId) };
  } catch (err) {
    return failure(operation, err);
  }
}

export async function loadUsers(customerId: string): Promise<UsersResult> {
  await requireAdminAction();
  return run("loadUsers", customerId, async () => {});
}

/** Sends an invitation email with a temporary password. */
export async function inviteCustomerUser(customerId: string, email: string): Promise<UsersResult> {
  await requireAdminAction();
  return run("inviteUser", customerId, async (id) => {
    const address = parseEmail(email);
    await inviteUser(id, address);
    console.info(`[admin-users] invited a user to ${JSON.stringify(id)}`);
  });
}

export async function resendCustomerInvite(customerId: string, username: string): Promise<UsersResult> {
  await requireAdminAction();
  return run("resendInvite", customerId, (id) => resendInvite(id, username));
}

export async function setCustomerUserEnabled(customerId: string, username: string, enabled: boolean): Promise<UsersResult> {
  const session = await requireAdminAction();
  return run("setUserEnabled", customerId, async (id) => {
    if (!enabled && username === session.sub) throw new UserAdminError("You can't disable your own account.");
    await setUserEnabled(id, username, enabled);
  });
}

export async function deleteCustomerUser(customerId: string, username: string): Promise<UsersResult> {
  const session = await requireAdminAction();
  return run("deleteUser", customerId, async (id) => {
    if (username === session.sub) throw new UserAdminError("You can't delete your own account.");
    await deleteUser(id, username);
    console.info(`[admin-users] deleted a user from ${JSON.stringify(id)}`);
  });
}

import "server-only";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  type AuthenticationResultType,
  type InitiateAuthCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";
import { getAuthConfig } from "./config";
import { computeSecretHash } from "./secret-hash";

/**
 * InitiateAuth, RespondToAuthChallenge and RevokeToken are public Cognito
 * APIs. The SDK sends them unsigned, so no AWS IAM credentials are needed or
 * used. Do not add access keys to this app.
 */

let client: CognitoIdentityProviderClient | undefined;

function getClient() {
  client ??= new CognitoIdentityProviderClient({ region: getAuthConfig().region });
  return client;
}

export interface TokenSet {
  idToken: string;
  accessToken: string;
  /** Present at sign-in; absent on a normal refresh. */
  refreshToken?: string;
  /** Lifetime of the ID and access tokens, in seconds. */
  expiresIn: number;
}

export type AuthStep =
  | { kind: "tokens"; tokens: TokenSet }
  | { kind: "new-password"; session: string; username: string }
  | { kind: "unsupported-challenge"; challengeName: string };

function toTokens(result: AuthenticationResultType | undefined): TokenSet {
  if (!result?.IdToken || !result.AccessToken) {
    throw new Error("Cognito returned no tokens");
  }
  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn ?? 3600,
  };
}

function toStep(out: Pick<InitiateAuthCommandOutput, "AuthenticationResult" | "ChallengeName" | "ChallengeParameters" | "Session">): AuthStep {
  if (out.AuthenticationResult) {
    return { kind: "tokens", tokens: toTokens(out.AuthenticationResult) };
  }
  const username = out.ChallengeParameters?.USER_ID_FOR_SRP;
  if (out.ChallengeName === "NEW_PASSWORD_REQUIRED" && out.Session && username) {
    return { kind: "new-password", session: out.Session, username };
  }
  return { kind: "unsupported-challenge", challengeName: out.ChallengeName ?? "UNKNOWN" };
}

/** USER_PASSWORD_AUTH. `email` must already be trimmed and lowercased. */
export async function initiatePasswordAuth(email: string, password: string): Promise<AuthStep> {
  const { clientId, clientSecret } = getAuthConfig();
  const out = await getClient().send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: computeSecretHash(email, clientId, clientSecret),
      },
    }),
  );
  return toStep(out);
}

/** Answers NEW_PASSWORD_REQUIRED. `username` is the challenge's USER_ID_FOR_SRP. */
export async function respondToNewPasswordChallenge(
  session: string,
  username: string,
  newPassword: string,
): Promise<AuthStep> {
  const { clientId, clientSecret } = getAuthConfig();
  const out = await getClient().send(
    new RespondToAuthChallengeCommand({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      ClientId: clientId,
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
        SECRET_HASH: computeSecretHash(username, clientId, clientSecret),
      },
    }),
  );
  return toStep(out);
}

/**
 * REFRESH_TOKEN_AUTH. The SECRET_HASH must use the cognito:username claim
 * (internal UUID), not the email, or Cognito rejects it.
 */
export async function refreshTokens(refreshToken: string, cognitoUsername: string): Promise<TokenSet> {
  const { clientId, clientSecret } = getAuthConfig();
  const out = await getClient().send(
    new InitiateAuthCommand({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
        SECRET_HASH: computeSecretHash(cognitoUsername, clientId, clientSecret),
      },
    }),
  );
  return toTokens(out.AuthenticationResult);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const { clientId, clientSecret } = getAuthConfig();
  await getClient().send(new RevokeTokenCommand({ Token: refreshToken, ClientId: clientId, ClientSecret: clientSecret }));
}

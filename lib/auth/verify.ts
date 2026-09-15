import "server-only";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { JwtExpiredError } from "aws-jwt-verify/error";
import type { CognitoIdTokenPayload } from "aws-jwt-verify/jwt-model";
import { getAuthConfig } from "./config";

function createVerifier() {
  const { userPoolId, clientId } = getAuthConfig();
  // Checks signature (against the pool's JWKS), expiry, issuer, audience and token_use.
  return CognitoJwtVerifier.create({ userPoolId, tokenUse: "id", clientId });
}

let verifier: ReturnType<typeof createVerifier> | undefined;

/** Returns the verified ID token claims, or null if the token is not valid. */
export async function verifyIdToken(token: string): Promise<CognitoIdTokenPayload | null> {
  verifier ??= createVerifier();
  try {
    return await verifier.verify(token);
  } catch (err) {
    if (!(err instanceof JwtExpiredError)) {
      // aws-jwt-verify leaves the raw JWT out of error messages by default.
      console.warn(`[auth] ID token rejected: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    return null;
  }
}

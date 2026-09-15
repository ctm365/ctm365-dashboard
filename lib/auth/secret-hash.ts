import "server-only";
import { createHmac } from "node:crypto";

/**
 * Cognito SECRET_HASH for a client that has a secret:
 * Base64(HMAC_SHA256(key = clientSecret, message = username + clientId)).
 *
 * For sign-in, username is the email. For the new-password challenge it is
 * USER_ID_FOR_SRP, and for refresh it is the cognito:username claim.
 */
export function computeSecretHash(username: string, clientId: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(username + clientId, "utf8").digest("base64");
}

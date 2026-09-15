/**
 * Cookie names only (no values, no secrets), kept separate so middleware can
 * import them without pulling in server-only modules.
 */
export const AUTH_COOKIE = {
  idToken: "id_token",
  accessToken: "access_token",
  refreshToken: "refresh_token",
  /** cognito:username (internal UUID). Needed for the refresh SECRET_HASH. */
  username: "ctm365_uid",
  /** Short-lived NEW_PASSWORD_REQUIRED challenge state. */
  challenge: "ctm365_challenge",
} as const;

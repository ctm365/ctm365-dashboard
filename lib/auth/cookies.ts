import "server-only";
import type { NextResponse } from "next/server";
import { AUTH_COOKIE } from "./cookie-names";
import type { TokenSet } from "./cognito";

/** Works with both `await cookies()` and `NextResponse#cookies`. */
type CookieJar = Pick<NextResponse["cookies"], "set">;

const REFRESH_MAX_AGE_S = 5 * 24 * 60 * 60;
const CHALLENGE_MAX_AGE_S = 3 * 60;

/**
 * Browsers drop Secure cookies on plain-HTTP origins, so a deployment without
 * TLS sets COOKIE_SECURE=false. Anything else keeps the production default.
 */
function secureCookies() {
  if (process.env.COOKIE_SECURE?.trim().toLowerCase() === "false") return false;
  return process.env.NODE_ENV === "production";
}

function baseOptions() {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: "/",
  };
}

export function setAuthCookies(jar: CookieJar, tokens: TokenSet, cognitoUsername: string) {
  const base = baseOptions();
  jar.set(AUTH_COOKIE.idToken, tokens.idToken, { ...base, maxAge: tokens.expiresIn });
  jar.set(AUTH_COOKIE.accessToken, tokens.accessToken, { ...base, maxAge: tokens.expiresIn });
  // Cognito only returns a refresh token at sign-in (or with rotation), so a
  // refresh keeps the existing cookie and its original expiry.
  if (tokens.refreshToken) {
    jar.set(AUTH_COOKIE.refreshToken, tokens.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE_S });
    jar.set(AUTH_COOKIE.username, cognitoUsername, { ...base, maxAge: REFRESH_MAX_AGE_S });
  }
}

export function clearAuthCookies(jar: CookieJar) {
  const base = baseOptions();
  for (const name of Object.values(AUTH_COOKIE)) {
    jar.set(name, "", { ...base, maxAge: 0 });
  }
}

export interface ChallengeState {
  session: string;
  username: string;
}

export function setChallengeCookie(jar: CookieJar, state: ChallengeState) {
  jar.set(AUTH_COOKIE.challenge, JSON.stringify(state), { ...baseOptions(), maxAge: CHALLENGE_MAX_AGE_S });
}

export function clearChallengeCookie(jar: CookieJar) {
  jar.set(AUTH_COOKIE.challenge, "", { ...baseOptions(), maxAge: 0 });
}

export function parseChallengeCookie(value: string | undefined): ChallengeState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ChallengeState).session === "string" &&
      typeof (parsed as ChallengeState).username === "string"
    ) {
      return parsed as ChallengeState;
    }
  } catch {
    // malformed cookie
  }
  return null;
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { CognitoIdTokenPayload } from "aws-jwt-verify/jwt-model";
import { refreshTokens, type TokenSet } from "./cognito";
import { AUTH_COOKIE } from "./cookie-names";
import { clearAuthCookies, clearChallengeCookie, setAuthCookies } from "./cookies";
import { isNotAuthorized, logAuthError } from "./errors";
import { verifyIdToken } from "./verify";

export interface Session {
  email: string;
  sub: string;
  /**
   * From the verified ID token's custom:customer_id claim, and nowhere else.
   * null means the account has no customer assigned: show no data.
   */
  customerId: string | null;
  /** ID token expiry, epoch ms. */
  expiresAt: number;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function toSession(claims: CognitoIdTokenPayload): Session {
  const customerId = claims["custom:customer_id"];
  return {
    email: typeof claims.email === "string" ? claims.email : "",
    sub: claims.sub,
    customerId: typeof customerId === "string" && customerId.trim() !== "" ? customerId : null,
    expiresAt: claims.exp * 1000,
  };
}

async function sessionFromIdToken(store: CookieStore): Promise<Session | null> {
  const idToken = store.get(AUTH_COOKIE.idToken)?.value;
  if (!idToken) return null;
  const claims = await verifyIdToken(idToken);
  return claims ? toSession(claims) : null;
}

function canRefresh(store: CookieStore) {
  return Boolean(store.get(AUTH_COOKIE.refreshToken)?.value && store.get(AUTH_COOKIE.username)?.value);
}

/**
 * Verifies freshly issued tokens and writes them to cookies. Only call where
 * cookies can be set (Server Actions, Route Handlers).
 */
export async function storeTokens(store: CookieStore, tokens: TokenSet): Promise<Session | null> {
  const claims = await verifyIdToken(tokens.idToken);
  if (!claims) return null;
  setAuthCookies(store, tokens, claims["cognito:username"]);
  clearChallengeCookie(store);
  return toSession(claims);
}

/**
 * For Route Handlers and Server Actions. Verifies the ID token and, if it is
 * missing or expired, uses the refresh token and writes the new tokens back.
 * Returns null when there is no valid session.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const current = await sessionFromIdToken(store);
  if (current || !canRefresh(store)) return current;

  try {
    const tokens = await refreshTokens(
      store.get(AUTH_COOKIE.refreshToken)!.value,
      store.get(AUTH_COOKIE.username)!.value,
    );
    return await storeTokens(store, tokens);
  } catch (err) {
    if (isNotAuthorized(err)) {
      // Refresh token expired or revoked: drop the dead cookies.
      clearAuthCookies(store);
    } else {
      logAuthError("refresh", err);
    }
    return null;
  }
}

export type SessionStatus = { state: "valid"; session: Session } | { state: "refreshable" } | { state: "none" };

/** Read-only check, safe in Server Components (never writes cookies). */
export async function getSessionStatus(): Promise<SessionStatus> {
  const store = await cookies();
  const session = await sessionFromIdToken(store);
  if (session) return { state: "valid", session };
  return canRefresh(store) ? { state: "refreshable" } : { state: "none" };
}

/**
 * For Server Component pages. Server Components can't set cookies, so an
 * expired ID token is refreshed by redirecting through /api/auth/refresh.
 */
export async function requireSession(returnTo: string): Promise<Session> {
  const status = await getSessionStatus();
  if (status.state === "valid") return status.session;
  if (status.state === "refreshable") {
    redirect(`/api/auth/refresh?next=${encodeURIComponent(returnTo)}`);
  }
  redirect("/login");
}

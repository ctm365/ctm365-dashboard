import { NextResponse, type NextRequest } from "next/server";
import { revokeRefreshToken } from "@/lib/auth/cognito";
import { AUTH_COOKIE } from "@/lib/auth/cookie-names";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { logAuthError } from "@/lib/auth/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(AUTH_COOKIE.refreshToken)?.value;
  if (refreshToken) {
    try {
      await revokeRefreshToken(refreshToken);
    } catch (err) {
      // Still sign out locally below.
      logAuthError("revoke", err);
    }
  }

  // 303 so the browser follows with a GET.
  const response = NextResponse.redirect(new URL("/login?reason=signed-out", request.url), 303);
  clearAuthCookies(response.cookies);
  return response;
}

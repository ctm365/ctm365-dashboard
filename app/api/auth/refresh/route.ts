import { NextResponse, type NextRequest } from "next/server";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only same-site relative paths, so this can't be used as an open redirect. */
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

/**
 * Server Components can't write cookies, so pages with an expired ID token
 * redirect here. getSession() refreshes and stores the new tokens.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  const headers = { "Cache-Control": "no-store" };
  if (session) {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url), { headers });
  }

  // Clear everything, even after a transient error, so /login can't bounce back here in a loop.
  const response = NextResponse.redirect(new URL("/login?reason=expired", request.url), { headers });
  clearAuthCookies(response.cookies);
  return response;
}

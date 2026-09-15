import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth/cookie-names";

/**
 * Convenience redirect only: it checks that an auth cookie exists, not that
 * it is valid. Every protected page and Route Handler verifies the session
 * itself with getSession() / requireSession().
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (request.cookies.has(AUTH_COOKIE.idToken) || request.cookies.has(AUTH_COOKIE.refreshToken)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|woff2?|txt|xml|map)$).*)"],
};

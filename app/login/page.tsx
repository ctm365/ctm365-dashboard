import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginPanel, type LoginStep } from "@/components/auth/login-panel";
import { AUTH_COOKIE } from "@/lib/auth/cookie-names";
import { parseChallengeCookie } from "@/lib/auth/cookies";
import { getSessionStatus } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · CTM365",
};

/** Fixed messages keyed by code, so the URL can't inject arbitrary text. */
const NOTICES: Record<string, string> = {
  expired: "Your session has ended. Please sign in again.",
  "challenge-expired": "Setting a new password took too long. Please sign in again with your temporary password.",
  "signed-out": "You've been signed out.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const status = await getSessionStatus();
  if (status.state === "valid") redirect("/");
  if (status.state === "refreshable") redirect("/api/auth/refresh?next=/");

  const store = await cookies();
  const initialStep: LoginStep = parseChallengeCookie(store.get(AUTH_COOKIE.challenge)?.value)
    ? "new-password"
    : "sign-in";

  const { reason } = await searchParams;
  const reasonKey = typeof reason === "string" && Object.hasOwn(NOTICES, reason) ? reason : "";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      {/* key remounts the panel when a redirect changes the step or notice. */}
      <LoginPanel key={`${initialStep}:${reasonKey}`} initialStep={initialStep} notice={NOTICES[reasonKey]} />
    </main>
  );
}

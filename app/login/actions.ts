"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { initiatePasswordAuth, respondToNewPasswordChallenge, type AuthStep } from "@/lib/auth/cognito";
import { isClientSecretPlaceholder } from "@/lib/auth/config";
import { AUTH_COOKIE } from "@/lib/auth/cookie-names";
import { clearChallengeCookie, parseChallengeCookie, setChallengeCookie } from "@/lib/auth/cookies";
import { authErrorMessage, isNotAuthorized, logAuthError } from "@/lib/auth/errors";
import { storeTokens } from "@/lib/auth/session";

export interface SignInState {
  status: "idle" | "error" | "new-password";
  message?: string;
}

export interface NewPasswordState {
  status: "idle" | "error";
  message?: string;
}

const GENERIC_ERROR = "Something went wrong signing you in. Please try again.";
const UNSUPPORTED_CHALLENGE =
  "This account needs a sign-in step this portal doesn't support. Contact your CTM365 administrator.";

function field(formData: FormData, name: string, maxLength: number) {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = field(formData, "email", 254).trim().toLowerCase();
  const password = field(formData, "password", 256);
  if (!email || !password) {
    return { status: "error", message: "Enter your email and password." };
  }

  if (isClientSecretPlaceholder()) {
    console.error("[auth] COGNITO_CLIENT_SECRET is still the placeholder. Set it in .env.local and restart.");
    return { status: "error", message: "Sign-in isn't set up on this server yet. Contact your CTM365 administrator." };
  }

  let step: AuthStep;
  try {
    step = await initiatePasswordAuth(email, password);
  } catch (err) {
    return { status: "error", message: authErrorMessage("sign-in", err) };
  }

  const store = await cookies();
  if (step.kind === "new-password") {
    // The challenge Session stays in an httpOnly cookie; the browser only learns which step to show.
    setChallengeCookie(store, { session: step.session, username: step.username });
    return { status: "new-password" };
  }
  if (step.kind === "unsupported-challenge") {
    logAuthError("sign-in", new Error(`Unsupported challenge ${step.challengeName}`));
    return { status: "error", message: UNSUPPORTED_CHALLENGE };
  }

  if (!(await storeTokens(store, step.tokens))) {
    logAuthError("sign-in", new Error("Issued ID token failed verification"));
    return { status: "error", message: GENERIC_ERROR };
  }
  redirect("/");
}

export async function setNewPassword(_prev: NewPasswordState, formData: FormData): Promise<NewPasswordState> {
  const newPassword = field(formData, "newPassword", 256);
  const confirmPassword = field(formData, "confirmPassword", 256);
  if (!newPassword) {
    return { status: "error", message: "Enter a new password." };
  }
  if (newPassword !== confirmPassword) {
    return { status: "error", message: "The passwords don't match." };
  }

  const store = await cookies();
  const challenge = parseChallengeCookie(store.get(AUTH_COOKIE.challenge)?.value);
  if (!challenge) {
    redirect("/login?reason=challenge-expired");
  }

  let step: AuthStep;
  try {
    step = await respondToNewPasswordChallenge(challenge.session, challenge.username, newPassword);
  } catch (err) {
    if (isNotAuthorized(err)) {
      // Here this means the 3-minute challenge Session expired or was already used.
      clearChallengeCookie(store);
      redirect("/login?reason=challenge-expired");
    }
    return { status: "error", message: authErrorMessage("new-password", err) };
  }

  if (step.kind !== "tokens") {
    logAuthError("new-password", new Error(`Unexpected step ${step.kind}`));
    clearChallengeCookie(store);
    return { status: "error", message: UNSUPPORTED_CHALLENGE };
  }

  if (!(await storeTokens(store, step.tokens))) {
    logAuthError("new-password", new Error("Issued ID token failed verification"));
    return { status: "error", message: GENERIC_ERROR };
  }
  redirect("/");
}

/** "Back to sign in" from the new-password step. */
export async function cancelNewPassword(): Promise<void> {
  clearChallengeCookie(await cookies());
}

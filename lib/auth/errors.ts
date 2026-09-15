import "server-only";
import { PASSWORD_POLICY } from "./password-policy";

const GENERIC = "Something went wrong signing you in. Please try again.";

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

/**
 * Logs the error class, message, and AWS request ID only. Cognito error
 * messages don't contain credentials, and inputs are never logged.
 */
export function logAuthError(operation: string, err: unknown) {
  const requestId = (err as { $metadata?: { requestId?: string } } | null)?.$metadata?.requestId;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[auth] ${operation} failed: ${errorName(err)}: ${message}${requestId ? ` (requestId ${requestId})` : ""}`);
}

/** Cognito's own policy detail, e.g. "Password must have symbol characters". */
function policyDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  const detail = message.split("policy:")[1]?.trim();
  return detail ? ` (${detail.replace(/\.$/, "")}.)` : "";
}

export function isNotAuthorized(err: unknown) {
  return errorName(err) === "NotAuthorizedException";
}

/** Maps a Cognito error to text that is safe to show in the browser. */
export function authErrorMessage(operation: "sign-in" | "new-password", err: unknown): string {
  switch (errorName(err)) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      // One message for both, so the form doesn't reveal whether an account exists.
      return "Incorrect email or password.";
    case "InvalidPasswordException":
      return `That password doesn't meet the requirements. ${PASSWORD_POLICY}${policyDetail(err)}`;
    case "InvalidParameterException":
      if (operation === "new-password") return `That password doesn't meet the requirements. ${PASSWORD_POLICY}`;
      break;
    case "PasswordResetRequiredException":
      return "Your password must be reset. Contact your CTM365 administrator.";
    case "TooManyRequestsException":
    case "LimitExceededException":
      logAuthError(operation, err);
      return "Too many attempts. Please wait and try again.";
  }
  logAuthError(operation, err);
  return GENERIC;
}

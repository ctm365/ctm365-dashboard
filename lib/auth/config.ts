import "server-only";

/**
 * The only place Cognito settings are read. None of these use NEXT_PUBLIC_,
 * so Next.js never inlines them into browser bundles.
 */

export interface AuthConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
}

const PLACEHOLDER_SECRET = "REPLACE_ME";

let cached: AuthConfig | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local, fill it in, and restart the server.`,
    );
  }
  return value;
}

export function getAuthConfig(): AuthConfig {
  cached ??= {
    region: required("COGNITO_REGION"),
    userPoolId: required("COGNITO_USER_POOL_ID"),
    clientId: required("COGNITO_CLIENT_ID"),
    clientSecret: required("COGNITO_CLIENT_SECRET"),
  };
  return cached;
}

/** True while .env.local still holds the placeholder secret from .env.example. */
export function isClientSecretPlaceholder(): boolean {
  return getAuthConfig().clientSecret === PLACEHOLDER_SECRET;
}

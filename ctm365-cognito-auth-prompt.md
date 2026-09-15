# Task: Add Amazon Cognito login + per-customer data scoping to the CTM365 dashboard

You are working in the CTM365 customer dashboard, an existing Next.js (App Router) project. It already has a Site → Asset → Sensor UI, an SSE Route Handler at `/api/stream` fed by a simulated data generator, hand-written shadcn-style UI primitives, and a React context/hook for live state. **Do not change that architecture.** Add authentication and tenant scoping on top of it.

Before writing code, read the project: `package.json` (note the exact Next.js version), `app/`, `lib/`, `components/`, the stream route, and the simulator. Follow the conventions of the installed Next.js version (for example, `cookies()` is async in Next 15+). Tell me what you found before making big changes.

## Fixed facts (use exactly)

- AWS region: `us-west-2`
- Cognito User Pool ID: `us-west-2_FP9dLmuKn`
- Cognito App Client ID: `nqn3gs2iakk9edsev36ih9o9p` (confidential client, has a secret)
- Sign-in identifier: email. Self-registration is disabled; the admin creates every account.
- Each user has the custom attribute `custom:customer_id`, which appears as a claim in the ID token.
- Admin-created users start in `FORCE_CHANGE_PASSWORD`, so first login returns a `NEW_PASSWORD_REQUIRED` challenge.

## Step 0: Read-only check of the Cognito config

If the AWS CLI is installed and configured, run these **read-only** commands. Do not run any command that creates, updates, or deletes AWS resources.

```bash
aws cognito-idp describe-user-pool --region us-west-2 --user-pool-id us-west-2_FP9dLmuKn
aws cognito-idp describe-user-pool-client --region us-west-2 --user-pool-id us-west-2_FP9dLmuKn --client-id nqn3gs2iakk9edsev36ih9o9p
```

Never print or echo the `ClientSecret` value from the second command. Pipe the output through `jq 'del(.UserPoolClient.ClientSecret)'` or equivalent.

Report whether each of these is true:
1. The pool schema contains a custom String attribute `customer_id` that is mutable.
2. `ExplicitAuthFlows` includes `ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`.
3. `ReadAttributes` includes `custom:customer_id`.
4. `WriteAttributes` is present and does **not** include `custom:customer_id`. If `WriteAttributes` is missing or empty, treat that as a FAIL, because Cognito then allows writing all attributes.
5. `DeletionProtection` is `ACTIVE`.

If the CLI is missing or lacks permission (AccessDenied), say so and continue. Do not try to fix AWS permissions. If any check fails, tell me clearly at the end, but still build the code.

## Step 1: Environment variables

- Create `.env.local` (if missing) with:
  ```
  COGNITO_REGION=us-west-2
  COGNITO_USER_POOL_ID=us-west-2_FP9dLmuKn
  COGNITO_CLIENT_ID=nqn3gs2iakk9edsev36ih9o9p
  COGNITO_CLIENT_SECRET=REPLACE_ME
  ```
  If `.env.local` already exists, add missing keys only. Never overwrite an existing `COGNITO_CLIENT_SECRET` value, and never read it aloud or print it.
- Create `.env.example` with the same keys and a placeholder secret.
- Make sure `.gitignore` covers `.env*.local`.
- None of these variables may use the `NEXT_PUBLIC_` prefix. Read them only in server code, through one module (e.g. `lib/auth/config.ts`) that imports `server-only` and throws a clear error if any is missing.

## Step 2: Server-side Cognito auth

Install `@aws-sdk/client-cognito-identity-provider` and `aws-jwt-verify` (plus `server-only` if not present).

The Cognito operations used here (`InitiateAuth`, `RespondToAuthChallenge`, `RevokeToken`) are public client APIs. They must **not** require AWS IAM credentials. Do not add AWS access keys to the app.

Build these, all server-only:

**Secret hash helper.** `SECRET_HASH = Base64(HMAC_SHA256(key = clientSecret, message = username + clientId))`, using Node `crypto`.

**Login** (`POST` Route Handler or Server Action):
- `InitiateAuth` with `AuthFlow: USER_PASSWORD_AUTH`, `USERNAME` = email (trimmed, lowercased), `PASSWORD`, `SECRET_HASH` computed with the email.
- On success, set the auth cookies (below) and redirect to the dashboard.
- On `ChallengeName === "NEW_PASSWORD_REQUIRED"`: store the challenge `Session` and the username from `ChallengeParameters.USER_ID_FOR_SRP` in a short-lived (3 minute) httpOnly cookie, then show the "set a new password" step. Never send the Session to client JavaScript state in a way that bypasses the httpOnly cookie.

**New password step:**
- `RespondToAuthChallenge` with `ChallengeName: NEW_PASSWORD_REQUIRED`, the stored `Session`, and `ChallengeResponses` of `USERNAME` = the stored `USER_ID_FOR_SRP` value, `NEW_PASSWORD`, and `SECRET_HASH` computed with that same `USER_ID_FOR_SRP` value.
- Require the user to type the new password twice and match them client-side before submitting.
- On success, set auth cookies, clear the challenge cookie, redirect to the dashboard.
- If the Session expired, send the user back to login with a friendly message.

**Error messages.** Map Cognito errors to user-friendly text:
- `NotAuthorizedException` and `UserNotFoundException` → one generic message: "Incorrect email or password." Do not reveal whether the account exists.
- `InvalidPasswordException` → explain the password policy (at least 8 characters with upper, lower, number, symbol), using Cognito's message if helpful.
- `PasswordResetRequiredException` → "Your password must be reset. Contact your CTM365 administrator."
- `TooManyRequestsException` / `LimitExceededException` → "Too many attempts. Please wait and try again."
- Anything else → a generic error, with details logged server-side only (never log passwords, tokens, or the secret).

**Cookies.** Store `id_token`, `access_token`, and `refresh_token` as separate cookies:
- `httpOnly: true`, `secure: process.env.NODE_ENV === "production"`, `sameSite: "lax"`, `path: "/"`.
- ID and access token `maxAge` = token `ExpiresIn` (currently 3600 s). Refresh token `maxAge` = 5 days.

**Session helper** `getSession()`:
- Verify the ID token with `CognitoJwtVerifier.create({ userPoolId, tokenUse: "id", clientId })`. This checks signature, expiry, issuer, and audience.
- If the ID token is missing or expired but a refresh token exists, call `InitiateAuth` with `AuthFlow: REFRESH_TOKEN_AUTH`, `REFRESH_TOKEN`, and `SECRET_HASH`. **Important gotcha:** for refresh, compute the secret hash with the `cognito:username` claim (the internal UUID username), not the email. Store that value in an httpOnly cookie (e.g. `ctm365_uid`) at login time, taken from the verified ID token. Write new tokens back to cookies where the Next.js context allows setting cookies (Route Handlers, Server Actions, middleware); elsewhere, redirect through a small refresh route.
- Return `{ email, sub, customerId }` where `customerId` = the `custom:customer_id` claim.
- If verification fails and refresh fails → return null.

**Logout** (`POST` route):
- Call `RevokeToken` with the refresh token, `ClientId`, and `ClientSecret` (token revocation is enabled on this client).
- Clear all auth cookies even if revocation fails. Redirect to `/login`.

## Step 3: Route protection (defense in depth)

- Add `middleware.ts` that redirects to `/login` when there is no auth cookie on any page except `/login`, the auth API routes, static assets, and `_next`. Middleware is only a convenience redirect.
- **Also** call `getSession()` in the server layout or page for every protected route, and inside every protected Route Handler, including `/api/stream`. Never rely on middleware alone.
- Check the installed Next.js version. If it is in a range affected by the middleware bypass advisory (CVE-2025-29927), upgrade to a patched release within the same major version and tell me.
- Signed-in users who visit `/login` get redirected to the dashboard.

## Step 4: Tenant scoping

This is the most important rule: **`customer_id` comes only from the verified ID token on the server.** Never read it from query strings, request bodies, headers, local storage, or client state.

- If a valid session has no `custom:customer_id` claim, do not show any data. Show an "Account not configured. Contact your CTM365 administrator." page with a sign-out button.
- Create a data access module (e.g. `lib/data/telemetry.ts`) whose functions all take `customerId` as a required first argument, for example `getCustomerSites(customerId)` and `streamCustomerReadings(customerId)`. For now they wrap the existing simulator. Later they will query DynamoDB `ctm365_telemetry` filtered by `customer_id`. Add a short comment saying so. Do not add DynamoDB code yet.
- Make `/api/stream` call `getSession()`, return 401 with no session, and only stream data from `streamCustomerReadings(session.customerId)`.
- Pass the display email to the UI and show it in the header with a **Sign out** button.

## Step 5: Login page UI

- Route: `/login`. Custom page, not Cognito Hosted UI.
- Match the existing dashboard branding: Space Grotesk for headings, IBM Plex Sans for body, soft cool background, engineering-blue accent. Reuse the existing card/button primitives.
- Contents: CTM365 wordmark, email field, password field with show/hide toggle, sign-in button with a loading state, and an error area. No sign-up link. A small line: "Need access? Contact your CTM365 administrator."
- Second state for "Set a new password": explain it is required on first sign-in, two password fields, policy hint, submit button.
- Accessible labels, keyboard-friendly, works on mobile widths.
- Use proper form submission via Server Actions or `fetch` to Route Handlers. Keep secrets and tokens out of client code.

## Step 6: Verify

1. Run `npm install`, the type check (`npx tsc --noEmit`), lint, and `npm run build`. Fix every error.
2. Search the client bundle output (`.next/static`) for `COGNITO_CLIENT_SECRET`, the client ID string, and `REPLACE_ME`, and confirm the secret name and value do not appear.
3. Add a small unit test for the secret hash helper against a known HMAC-SHA256 vector.
4. Run `npm run dev` and confirm: `/` redirects to `/login` when signed out; `/api/stream` returns 401 when signed out; the login page renders.
5. If `COGNITO_CLIENT_SECRET` is still `REPLACE_ME`, stop there and tell me to add the real secret and create a test user. Do not attempt real logins against Cognito with a placeholder.

## Final report

When done, give me:
- Results of the Step 0 checks (pass/fail for each of the five).
- A list of files added and changed.
- Any Next.js upgrade you made.
- Exactly what I need to do next to test a real login.
- Any assumptions or open questions.

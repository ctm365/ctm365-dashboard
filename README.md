# CTM365 customer dashboard

Next.js 15 (App Router) dashboard for CTM365 thermal monitoring. Sign-in uses Amazon Cognito; data is still simulated. DynamoDB comes next.

## Requirements

- Node.js 20.9 or newer (22 LTS recommended). Check with `node -v`.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Other scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Project layout

- `app/page.tsx`: dashboard page (server component; verifies the session, loads the customer's site layout)
- `app/login/`: custom sign-in page and its Server Actions (sign in, set new password)
- `app/api/stream/route.ts`: live readings over Server-Sent Events (verifies the session itself)
- `app/api/auth/logout`, `app/api/auth/refresh`: sign out (revokes the refresh token) and token refresh for pages
- `middleware.ts`: convenience redirect to `/login` when no auth cookie exists (not a security boundary)
- `lib/auth/`: server-only Cognito code: config, secret hash, token verification, cookies, `getSession()`, `requireAdmin()`
- `app/admin/`: staff-only label editor (Cognito group `Admins`); every page and Server Action checks admin itself
- `lib/config/`: customer site layouts in DynamoDB `ctm365_customer_config` (server-only store, shared validation)
- `components/admin/`: config editor and inline-edit controls
- `lib/telemetry.ts`: data access layer; every function takes `customerId` first
- `lib/simulator.ts`: simulated Exertherm readings (replaced later by DynamoDB)
- `lib/fleet.ts`: site layout placeholder, thresholds, unit conversion
- `lib/live-fleet.tsx`: React context and hook holding live state in the browser
- `components/ui/`: small shared primitives (card, button, badge, table)
- `components/dashboard/`: dashboard sections

## Units and thresholds

Readings are stored in Celsius (`deltaC`, matching `temperature_rise_c` in DynamoDB) and shown in Fahrenheit. Watch and critical thresholds live in `lib/fleet.ts` and are placeholders.

## Authentication and tenant scoping

- Users are created by an admin in the Cognito pool; there is no sign-up. First sign-in asks for a new password.
- Tokens live in httpOnly cookies. `getSession()` (Route Handlers, Server Actions) and `requireSession()` (pages) verify the ID token on every request.
- `customerId` comes only from the verified ID token's `custom:customer_id` claim. Never take it from the request. Accounts without the claim see "Account not configured" and no data.
- Users in the Cognito `Admins` group can open `/admin`. Group changes take effect at their next sign-in or token refresh.
- The server reads DynamoDB with the default AWS credential chain (locally, your AWS CLI profile). No AWS keys go in `.env.local`.

## Secrets

Copy `.env.example` to `.env.local` for Cognito settings. `.env.local` is git-ignored. Never commit it, and keep this folder out of OneDrive or other cloud-synced folders.

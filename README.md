# CTM365 customer dashboard

Next.js 15 (App Router) dashboard for CTM365 thermal monitoring. Currently runs on simulated data. Cognito login and DynamoDB data come next.

## Requirements

- Node.js 20.9 or newer (22 LTS recommended). Check with `node -v`.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Project layout

- `app/page.tsx`: dashboard page (server component; loads the customer's site layout)
- `app/api/stream/route.ts`: live readings over Server-Sent Events
- `lib/telemetry.ts`: data access layer; every function takes `customerId` first
- `lib/simulator.ts`: simulated Exertherm readings (replaced later by DynamoDB)
- `lib/fleet.ts`: site layout placeholder, thresholds, unit conversion
- `lib/live-fleet.tsx`: React context and hook holding live state in the browser
- `components/ui/`: small shared primitives (card, button, badge, table)
- `components/dashboard/`: dashboard sections

## Units and thresholds

Readings are stored in Celsius (`deltaC`, matching `temperature_rise_c` in DynamoDB) and shown in Fahrenheit. Watch and critical thresholds live in `lib/fleet.ts` and are placeholders.

## Secrets

Copy `.env.example` to `.env.local` for Cognito settings. `.env.local` is git-ignored. Never commit it, and keep this folder out of OneDrive or other cloud-synced folders.

# Task: Ship the HVAC monitoring section to dashboard.ctm365.com

The code changes are already in this working folder (made outside Claude Code). Your job is to verify, commit, push, and deploy them to the EC2 instance the same way as the earlier deploy task. If I haven't given you the Elastic IP and key path in this session, ask rather than guessing.

## What changed (already done, don't rewrite)
- `lib/hvac.ts` (new): reads `ctm365_hvac_telemetry` for the HVAC units listed in the customer's config.
- `app/api/hvac/route.ts` (new): session-checked JSON endpoint, `?hours=6|24|168`.
- `components/dashboard/hvac-section.tsx` (new): HVAC cards, live readouts, and trend charts; polls every 60 s.
- `components/dashboard/dashboard.tsx`: shows the HVAC section; the "no sensors" message only appears when a customer has neither sensors nor HVAC units.
- `lib/types.ts`, `lib/fleet.ts`, `lib/telemetry.ts`, `lib/config/types.ts`, `lib/config/store.ts`: new `hvacUnits` list on the customer config (kept intact by the admin editor's saves).

AWS side is already done: the EC2 role `ctm365-dashboard-ec2-role` has a new inline policy `ctm365-hvac-telemetry-read` (Query/GetItem on `ctm365_hvac_telemetry`), and customer `demo` has `hvacUnits = [{ id: "bard-01", name: "Bard W42HC Heat Pump" }]`.

## Step 1: Verify locally
```
npm run typecheck
npm run lint
npm run build
```
All three must pass (the existing `<img>` lint warning in site-header is known). Report any error and stop.

## Step 2: Commit and push
```
git add -A
git status
git commit -m "Add HVAC monitoring section (live readings from ctm365_hvac_telemetry)"
git push origin main
```
Confirm `.env.local` is NOT in the commit.

## Step 3: Deploy on EC2
```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "cd ~/ctm365-dashboard && GIT_SSH_COMMAND='ssh -i ~/.ssh/deploy_key' git pull && npm install && npm run build && pm2 restart ctm365-dashboard && pm2 status"
```
If the build runs out of memory, report it and stop.

## Step 4: Verify
```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/hvac"
```
Expect `401` (signed out is correct). Then tell me to sign in at https://dashboard.ctm365.com as a user on customer `demo` and check that the HVAC section shows the Bard unit as Online with live readings.

## Report
Each step's result, the commit hash, `pm2 status`, and any errors verbatim.

# Task: Add an admin page for editing per-customer dashboard labels

You are working in the existing CTM365 Next.js dashboard. It already has Cognito sign-in for customers (see `lib/auth/`), a live dashboard reading from `lib/telemetry.ts`, and a hand-written UI kit in `components/ui/`. Read the current state of `lib/auth/session.ts`, `lib/telemetry.ts`, `lib/fleet.ts`, `app/page.tsx`, and `components/dashboard/site-header.tsx` before changing anything, and tell me what you found.

**Do not change customer-facing behavior** except where this task explicitly requires it (swapping the data source in `getCustomerSite`). Sign-in, the live dashboard, and the stream route should work exactly as before for a signed-in customer.

## What this feature is

An `/admin` area, visible only to CTM365 staff, where a staff member can:
- See a list of customers (by `customer_id`) and add a new one.
- For a selected customer, click directly on the site name, an asset's name, or a sensor's name and type a replacement, the way you'd edit a label in place, not through a traditional form.
- Add or remove assets and sensors, and set which physical channel (1-8) a sensor's display name corresponds to.

This is a labeling tool. Sensor data itself is still simulated; nothing here wires up real telemetry.

## Fixed facts

- AWS account 593989447113, region `us-west-2`.
- CLI identity: `ctm365-cli-user`, a deliberately scoped-down IAM user. It has already failed AccessDenied on a Cognito describe call once before, so expect some of Step 0 to be out of its reach.
- Cognito user pool `CTM365 Customers`, ID `us-west-2_FP9dLmuKn`.
- My own admin login should be `chriskosmas4444@gmail.com`.
- The Next.js server picks up AWS credentials from the same local AWS CLI profile already used for the earlier Cognito checks — no access keys belong in `.env.local`.

## Step 0: Set up the AWS resources this needs, then verify

Attempt each piece yourself via the AWS CLI, in order. For each, check whether it already exists before creating it, and skip cleanly if so. **If a call fails with an authorization error, do not work around it** — don't request broader credentials, don't try a different principal, don't guess at reduced permissions that might work. Stop attempting that one piece, report the exact command and error, and tell me the console steps for that piece specifically. Keep going with the rest regardless.

**0a. Confirm identity**
```
aws sts get-caller-identity
```
Confirm this is `ctm365-cli-user` in account 593989447113.

**0b. Create the DynamoDB table if it doesn't exist**
```
aws dynamodb describe-table --table-name ctm365_customer_config --region us-west-2
```
If that returns `ResourceNotFoundException`, create it:
```
aws dynamodb create-table \
  --table-name ctm365_customer_config \
  --attribute-definitions AttributeName=customer_id,AttributeType=S \
  --key-schema AttributeName=customer_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-west-2
```
Poll `describe-table` briefly until its status is `ACTIVE`. This step is required for anything else to work — if table creation itself fails on permissions, stop and tell me before continuing, since there's no point writing code against a table that doesn't exist and that I'd then need to create manually anyway.

**0c. Attach the inline IAM policy this app needs, if not already attached**
```
aws iam get-user-policy --user-name ctm365-cli-user --policy-name ctm365-customer-config-access
```
If that returns `NoSuchEntity`, create a local `policy.json` with exactly:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CTM365CustomerConfigReadWrite",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:us-west-2:593989447113:table/ctm365_customer_config"
    }
  ]
}
```
then run:
```
aws iam put-user-policy --user-name ctm365-cli-user --policy-name ctm365-customer-config-access --policy-document file://policy.json
```
If this fails with `AccessDenied`, that's expected for a properly scoped-down user (it shouldn't normally be able to grant itself new permissions) — report it plainly, don't retry with different arguments, and tell me to attach it myself via IAM console → Users → ctm365-cli-user → Add permissions → Create inline policy → JSON, pasting the same policy above.

**0d. Create the Admins Cognito group and add my account, if not already done**
```
aws cognito-idp get-group --group-name Admins --user-pool-id us-west-2_FP9dLmuKn --region us-west-2
```
If this fails (`AccessDenied` or `ResourceNotFoundException`), try creating it once:
```
aws cognito-idp create-group --group-name Admins --user-pool-id us-west-2_FP9dLmuKn --region us-west-2
```
If group creation fails on permissions, stop there — report it and tell me the console steps (Cognito → CTM365 Customers → Groups → Create group, name exactly `Admins`, then open it → Add user → select `chriskosmas4444@gmail.com`).

If the group exists or was just created, check and fix membership:
```
aws cognito-idp admin-list-groups-for-user --username chriskosmas4444@gmail.com --user-pool-id us-west-2_FP9dLmuKn --region us-west-2
```
Add if missing:
```
aws cognito-idp admin-add-user-to-group --user-pool-id us-west-2_FP9dLmuKn --username chriskosmas4444@gmail.com --group-name Admins --region us-west-2
```

**Report before moving on.** Tell me plainly which of the three (table, IAM policy, Admins group + membership) you completed yourself versus which need my manual action in console, with the exact error for each fallback. Proceed to Step 1 regardless — the code doesn't need the IAM policy or the Admins group to exist to compile or build, only to actually work when tested. Make that limitation clear in your final report if either is still pending.

## Step 1: Data model

Create `lib/config/types.ts`:

```ts
export interface AssetConfig {
  id: string;
  name: string;
}

export interface SensorConfig {
  id: string;
  name: string;
  assetId: string;
  /** Physical Exertherm Datacard channel, 1-8. Informational only for now. */
  channel: number;
}

export interface CustomerConfig {
  customerId: string;
  siteName: string;
  assets: AssetConfig[];
  sensors: SensorConfig[];
  updatedAt: string;
}
```

## Step 2: Server-only DynamoDB access

Create `lib/config/store.ts`, importing `server-only`. Use `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` (install both) so you can work with plain JS objects via `DynamoDBDocumentClient`. Build the client once, region `us-west-2`, no explicit credentials (let the default provider chain resolve them).

Functions:
- `getCustomerConfig(customerId: string): Promise<CustomerConfig | null>` — `GetItem` by `customer_id`, return null if not found.
- `putCustomerConfig(config: CustomerConfig): Promise<void>` — `PutItem`, stamping `updatedAt` with the current ISO timestamp.
- `listCustomerConfigs(): Promise<CustomerConfig[]>` — `Scan`. Fine at this scale; note in a comment that this should become a proper index if the customer count grows a lot.
- `deleteCustomerConfig(customerId: string): Promise<void>` — for removing a customer entirely, used sparingly.

Validate `customerId` format wherever it's accepted from a form: lowercase letters, numbers, and hyphens only, 2-64 characters. Reject anything else with a clear error rather than writing it.

## Step 3: Admin session check

In `lib/auth/session.ts`, find how the session is built from the verified ID token. Add the `cognito:groups` claim (an array of strings, may be absent) to whatever session object `getSession()` / `requireSession()` return, as `groups: string[]`. Add a small helper, e.g. `isAdmin(session)` returning `session.groups.includes("Admins")`.

Create a `requireAdmin()` helper (mirroring how `requireSession()` already works) that redirects non-admins to `/login` if signed out, or to `/` (their normal dashboard) if signed in but not in the `Admins` group. Every admin page and every admin Server Action must call this independently — never rely on one check protecting another.

## Step 4: Point the dashboard at real config

In `lib/telemetry.ts`, change `getCustomerSite(customerId)` to:
1. Call `getCustomerConfig(customerId)`.
2. If found, map it to the existing `SiteDef` shape (`site.id` can just be `customerId`).
3. If not found, return an empty site: `{ id: customerId, name: "Unnamed site", assets: [], sensors: [] }` rather than throwing. The dashboard and stream route should handle an empty sensor list gracefully — check `components/dashboard/` for the least invasive way to show a "no sensors configured yet" message without breaking the layout.

This means the existing `demo` customer will show as unconfigured until someone fills it in through the new admin page — that's expected, not a bug.

## Step 5: The admin UI

**`app/admin/page.tsx`** (server component): call `requireAdmin()`. List customers from `listCustomerConfigs()`, each linking to `app/admin/[customerId]/page.tsx`. Include a small form to add a new customer: a text input for `customerId`, validated as in Step 2, submitting to a Server Action that creates an empty `CustomerConfig` and redirects to that customer's editor.

**`app/admin/[customerId]/page.tsx`** (server component): call `requireAdmin()`, load the config via `getCustomerConfig`, pass it to a client component that renders the editable view.

**`components/admin/config-editor.tsx`** (client component): the editing surface. Reuse existing design tokens and primitives from `components/ui/` so this feels like the same product. Show:
- The site name as an editable text field.
- Each asset as a group heading (editable name) containing its sensors.
- Each sensor as a row: editable name, a small number input for its channel (1-8), a remove button.
- An "Add sensor" action per asset, and an "Add asset" action for the site.

**`components/admin/editable-text.tsx`**: a reusable inline-edit control. Displays the current value as plain text. On click, becomes a focused text input with the text selected. On blur or Enter, calls the provided save function. Escape cancels and reverts. While saving, show a subtle pending state; briefly confirm on success; show an inline error and allow retry on failure. Make it keyboard accessible (reachable and operable via Tab and Enter, not just click), with a clear accessible label via a prop.

**`app/admin/actions.ts`**: Server Actions, each starting with `await requireAdmin()`:
- `updateSiteName(customerId, name)`
- `addAsset(customerId, name)` — generate an id with `crypto.randomUUID()`
- `renameAsset(customerId, assetId, name)`
- `removeAsset(customerId, assetId)` — also removes that asset's sensors
- `addSensor(customerId, assetId, name, channel)`
- `renameSensor(customerId, sensorId, name)`
- `setSensorChannel(customerId, sensorId, channel)`
- `removeSensor(customerId, sensorId)`

Trim and length-cap all text input (80 characters for names is reasonable). Reject empty names rather than saving blank labels. After each mutation, revalidate the admin page path so the list stays current.

## Step 6: Optional

If it's low-effort given how you've structured things, add a small "Admin" link in `components/dashboard/site-header.tsx`, visible only when `isAdmin(session)` is true. Skip it without asking if it would require restructuring how the header gets its session data.

## Step 7: Verify

1. `npm install`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Fix everything.
2. Confirm no AWS credential material appears in `.next/static`.
3. With `npm run dev` running: confirm `/admin` redirects a signed-out visitor to `/login`. If you can test it, confirm it's unreachable for a signed-in user not in the `Admins` group; otherwise note it as untested and tell me how to test it myself.
4. Confirm a fresh customer_id with no config shows the "no sensors configured yet" state on the real dashboard rather than an error.

## Final report

- Step 0 results: what you set up yourself vs. what needs my manual action, with exact errors for anything that fell back.
- Files added and changed.
- Anything skipped from Step 6 and why.
- Exactly what I should click through to test this myself.
- Any assumptions or open questions.

import type { SiteDef, Status, Thresholds } from "./types";

/**
 * Default sensor list for the simulator only. Customer site layouts now come
 * from the ctm365_customer_config DynamoDB table (see lib/telemetry.ts).
 */
export const DEMO_SITE: SiteDef = {
  id: "site-01",
  name: "Site Name",
  assets: [
    { id: "asset-1", name: "Asset 1" },
    { id: "asset-2", name: "Asset 2" },
  ],
  sensors: [
    { id: "sensor-1", name: "Sensor 1", assetId: "asset-1", channel: 1 },
    { id: "sensor-2", name: "Sensor 2", assetId: "asset-1", channel: 2 },
    { id: "sensor-3", name: "Sensor 3", assetId: "asset-2", channel: 3 },
    { id: "sensor-4", name: "Sensor 4", assetId: "asset-2", channel: 4 },
  ],
};

/** Placeholder thresholds. Confirm against your own condition-monitoring criteria. */
export const THRESHOLDS: Thresholds = {
  watchF: 18,
  criticalF: 45,
};

export const cToF = (deltaC: number) => deltaC * 1.8;

export function statusFor(deltaC: number, t: Thresholds = THRESHOLDS): Status {
  const f = cToF(deltaC);
  if (f >= t.criticalF) return "critical";
  if (f >= t.watchF) return "watch";
  return "normal";
}

export const STATUS_LABEL: Record<Status, string> = {
  normal: "Normal",
  watch: "Watch",
  critical: "Critical",
};

/** How many readings the browser keeps per sensor (2 s interval → 12 minutes). */
export const HISTORY_LIMIT = 360;
export const STREAM_INTERVAL_MS = 2000;

import type { SiteDef, Status, TempUnit, Thresholds } from "./types";

/**
 * Default thresholds for any customer that hasn't set their own on /admin:
 * a 10°C rise is on watch, 25°C is critical. These are exactly the old
 * hardcoded 18°F and 45°F placeholders, so existing customers see no change.
 * Confirm against your own condition-monitoring criteria.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  watchC: 10,
  criticalC: 25,
};

export const DEFAULT_TEMP_UNIT: TempUnit = "F";

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
  unit: DEFAULT_TEMP_UNIT,
  thresholds: DEFAULT_THRESHOLDS,
  hvacUnits: [],
};

/**
 * Both conversions are for temperature *rise* (a difference between two
 * temperatures), so they scale by 1.8 with no +32 offset.
 */
export const cToF = (deltaC: number) => deltaC * 1.8;

/** Converts a stored Celsius rise into the unit being displayed. */
export const convertRise = (deltaC: number, unit: TempUnit) => (unit === "F" ? cToF(deltaC) : deltaC);

/** Converts a rise typed in the displayed unit back to Celsius, rounded to keep stored values tidy. */
export const riseToC = (value: number, unit: TempUnit) => Math.round((unit === "F" ? value / 1.8 : value) * 1000) / 1000;

export function statusFor(deltaC: number, t: Thresholds = DEFAULT_THRESHOLDS): Status {
  if (deltaC >= t.criticalC) return "critical";
  if (deltaC >= t.watchC) return "watch";
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

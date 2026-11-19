import type { Status, TempUnit, Thresholds } from "./types";

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

/** Exertherm datacards report about every 15 seconds; the server checks for new readings this often. */
export const ELECTRICAL_POLL_MS = 15_000;
/** How far back the Electrical page loads when it opens. */
export const HISTORY_WINDOW_MS = 90 * 60_000;
/** How many readings the browser keeps per sensor (15 s readings → 90 minutes). */
export const HISTORY_LIMIT = 360;
/** With no new reading for this long, the dashboard says data has stopped. */
export const STALE_AFTER_MS = 2 * 60_000;

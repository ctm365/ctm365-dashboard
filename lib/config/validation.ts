/**
 * Input rules for the admin config editor. No server-only import, so the
 * browser can show the same limits; the server always re-checks.
 */

export const CUSTOMER_ID_RULE = "Lowercase letters, numbers, and hyphens only, 2-64 characters.";
export const NAME_MAX_LENGTH = 80;
export const CHANNEL_MIN = 1;
export const CHANNEL_MAX = 8;
/** Keeps a single DynamoDB item well under its 400 KB limit. */
export const MAX_ASSETS = 50;
export const MAX_SENSORS = 200;

const CUSTOMER_ID_PATTERN = /^[a-z0-9-]{2,64}$/;

/** A rejected edit whose message is safe to show to the admin. */
export class ConfigInputError extends Error {
  name = "ConfigInputError";
}

export function isValidCustomerId(value: unknown): value is string {
  return typeof value === "string" && CUSTOMER_ID_PATTERN.test(value);
}

export function parseCustomerId(value: unknown): string {
  if (!isValidCustomerId(value)) {
    throw new ConfigInputError(`Invalid customer ID. ${CUSTOMER_ID_RULE}`);
  }
  return value;
}

/** Trims and caps a label; rejects blanks. */
export function parseName(value: unknown, what = "Name"): string {
  const name = typeof value === "string" ? value.trim().slice(0, NAME_MAX_LENGTH) : "";
  if (!name) {
    throw new ConfigInputError(`${what} can't be empty.`);
  }
  return name;
}

/** Largest temperature rise (°C) an admin can set a threshold to. */
export const THRESHOLD_MAX_C = 200;

export function isTempUnit(value: unknown): value is "F" | "C" {
  return value === "F" || value === "C";
}

export function parseTempUnit(value: unknown): "F" | "C" {
  if (!isTempUnit(value)) throw new ConfigInputError("Temperature unit must be °F or °C.");
  return value;
}

function isValidThresholdPair(watchC: unknown, criticalC: unknown): boolean {
  return (
    typeof watchC === "number" &&
    typeof criticalC === "number" &&
    Number.isFinite(watchC) &&
    Number.isFinite(criticalC) &&
    watchC > 0 &&
    criticalC > watchC &&
    criticalC <= THRESHOLD_MAX_C
  );
}

/** Strict check for admin input; the message is safe to show. Values are Celsius rise. */
export function parseThresholds(watchC: unknown, criticalC: unknown): { watchC: number; criticalC: number } {
  if (typeof watchC !== "number" || typeof criticalC !== "number" || !Number.isFinite(watchC) || !Number.isFinite(criticalC)) {
    throw new ConfigInputError("Enter a number for both limits.");
  }
  if (watchC <= 0) throw new ConfigInputError("The Watch limit must be above zero.");
  if (criticalC <= watchC) throw new ConfigInputError("The Critical limit must be higher than the Watch limit.");
  if (criticalC > THRESHOLD_MAX_C) {
    throw new ConfigInputError(`The Critical limit can't be more than ${THRESHOLD_MAX_C}°C (${THRESHOLD_MAX_C * 1.8}°F) of rise.`);
  }
  return { watchC, criticalC };
}

/**
 * Lenient read for items already in DynamoDB (they can be hand-edited, and
 * older items have no thresholds at all): anything invalid becomes the fallback.
 */
export function normalizeThresholds(
  value: unknown,
  fallback: { watchC: number; criticalC: number },
): { watchC: number; criticalC: number } {
  const t = value as { watchC?: unknown; criticalC?: unknown } | null | undefined;
  return isValidThresholdPair(t?.watchC, t?.criticalC)
    ? { watchC: t!.watchC as number, criticalC: t!.criticalC as number }
    : fallback;
}

export function parseChannel(value: unknown): number {
  const channel = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof channel !== "number" || !Number.isInteger(channel) || channel < CHANNEL_MIN || channel > CHANNEL_MAX) {
    throw new ConfigInputError(`Channel must be a whole number from ${CHANNEL_MIN} to ${CHANNEL_MAX}.`);
  }
  return channel;
}

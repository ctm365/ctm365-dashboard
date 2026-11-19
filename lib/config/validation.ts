/**
 * Input rules for the admin config editor. No server-only import, so the
 * browser can show the same limits; the server always re-checks.
 */

export const CUSTOMER_ID_RULE =
  "Any letters, numbers, spaces, or symbols, 2-64 characters. Capital letters count, and spaces at the start or end are removed.";
export const CUSTOMER_ID_MIN_LENGTH = 2;
export const CUSTOMER_ID_MAX_LENGTH = 64;
export const NAME_MAX_LENGTH = 80;
export const CHANNEL_MIN = 1;
export const CHANNEL_MAX = 8;
/** Keeps a single DynamoDB item well under its 400 KB limit. */
export const MAX_ASSETS = 50;
export const MAX_SENSORS = 200;
export const MAX_HVAC_UNITS = 50;

/**
 * An HVAC unit's ID is the last part of the gateway's MQTT topic
 * (ctm365/<site>/hvac/<unit>), so it is limited to characters that are safe
 * in a topic and in the telemetry table's key.
 */
export const HVAC_UNIT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const HVAC_UNIT_ID_RULE =
  "Letters, numbers, dots, hyphens and underscores, up to 64 characters. Must match the end of the gateway's MQTT topic, e.g. bard-01.";

/**
 * Any characters except invisible control characters (tabs, line breaks),
 * which can't be told apart on screen from the Cognito value they must match.
 */
const CUSTOMER_ID_PATTERN = /^[^\p{Cc}]+$/u;

/** A rejected edit whose message is safe to show to the admin. */
export class ConfigInputError extends Error {
  name = "ConfigInputError";
}

/**
 * True for an ID as stored: 2-64 characters, no control characters, and no
 * spaces at either end. Case-sensitive: "Acme" and "acme" are two customers.
 */
export function isValidCustomerId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= CUSTOMER_ID_MIN_LENGTH &&
    value.length <= CUSTOMER_ID_MAX_LENGTH &&
    CUSTOMER_ID_PATTERN.test(value)
  );
}

/** Trims spaces from both ends, then checks the rule. */
export function parseCustomerId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : value;
  if (!isValidCustomerId(id)) {
    throw new ConfigInputError(`Invalid customer ID. ${CUSTOMER_ID_RULE}`);
  }
  return id;
}

/** The admin page for a customer. IDs can hold spaces, slashes, "?" or "#", so they are encoded. */
export function adminCustomerPath(customerId: string): string {
  return `/admin/${encodeURIComponent(customerId)}`;
}

export const DATACARD_ID_RULE =
  "Letters, numbers, dots, hyphens and underscores, up to 64 characters. Must match the end of the electrical gateway's MQTT topic, e.g. exertherm-07.";

/** A blank value clears the datacard (no readings until one is set). */
export function parseDatacardId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  if (id === "") return null;
  if (!HVAC_UNIT_ID_PATTERN.test(id)) throw new ConfigInputError(`Invalid datacard ID. ${DATACARD_ID_RULE}`);
  return id;
}

/** Lenient read for stored items: anything that isn't a valid ID means no datacard. */
export function normalizeDatacardId(value: unknown): string | null {
  return typeof value === "string" && HVAC_UNIT_ID_PATTERN.test(value) ? value : null;
}

export function parseHvacUnitId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!HVAC_UNIT_ID_PATTERN.test(id)) throw new ConfigInputError(`Invalid unit ID. ${HVAC_UNIT_ID_RULE}`);
  return id;
}

/** A plain check that catches typos; Cognito's own email delivery is the real test. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims and lower-cases, so the same person can't get two accounts by capitalization. */
export function parseEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new ConfigInputError("Enter a valid email address.");
  return email;
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

/** Strict check for admin input: both services must be given as true or false. */
export function parseServices(value: unknown): { electrical: boolean; hvac: boolean } {
  const v = value as { electrical?: unknown; hvac?: unknown } | null | undefined;
  if (typeof v?.electrical !== "boolean" || typeof v?.hvac !== "boolean") {
    throw new ConfigInputError("Choose on or off for each service.");
  }
  return { electrical: v.electrical, hvac: v.hvac };
}

/**
 * Lenient read for items already in DynamoDB. Items saved before services
 * existed have no field at all: they get the services they already have
 * something set up for, so no existing customer's dashboard changes.
 */
export function normalizeServices(
  value: unknown,
  existing: { hasElectricalSetup: boolean; hasHvacSetup: boolean },
): { electrical: boolean; hvac: boolean } {
  const v = value as { electrical?: unknown; hvac?: unknown } | null | undefined;
  if (typeof v?.electrical === "boolean" && typeof v?.hvac === "boolean") {
    return { electrical: v.electrical, hvac: v.hvac };
  }
  return { electrical: existing.hasElectricalSetup, hvac: existing.hasHvacSetup };
}

export function parseChannel(value: unknown): number {
  const channel = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof channel !== "number" || !Number.isInteger(channel) || channel < CHANNEL_MIN || channel > CHANNEL_MAX) {
    throw new ConfigInputError(`Channel must be a whole number from ${CHANNEL_MIN} to ${CHANNEL_MAX}.`);
  }
  return channel;
}

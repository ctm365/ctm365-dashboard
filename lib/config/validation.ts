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

export function parseChannel(value: unknown): number {
  const channel = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof channel !== "number" || !Number.isInteger(channel) || channel < CHANNEL_MIN || channel > CHANNEL_MAX) {
    throw new ConfigInputError(`Channel must be a whole number from ${CHANNEL_MIN} to ${CHANNEL_MAX}.`);
  }
  return channel;
}

import type { Reading, SensorDef } from "./types";

/**
 * Pure conversions for Exertherm datacard messages (no AWS or server-only
 * imports, so they can be unit-tested). See lib/electrical.ts for the reader.
 */

/** Exertherm datacard raw value to degrees Celsius of rise. */
const RAW_TO_C = 0.1;

/** One datacard message: rise in Celsius per channel (1-8). A channel is missing if the card didn't report it. */
export interface DatacardSample {
  ts: number;
  channels: Partial<Record<number, number>>;
}

export function toSample(item: Record<string, unknown>): DatacardSample | null {
  const ts = Number(item.timestamp);
  if (!Number.isFinite(ts)) return null;
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const channels: Partial<Record<number, number>> = {};
  for (let ch = 1; ch <= 8; ch++) {
    const raw = props[`Sensor${ch}`];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) channels[ch] = Math.round(n * RAW_TO_C * 100) / 100;
  }
  return { ts, channels };
}

/** Turns datacard samples into one reading per configured sensor, using each sensor's channel. */
export function samplesToReadings(samples: DatacardSample[], sensors: Pick<SensorDef, "id" | "channel">[]): Reading[] {
  const out: Reading[] = [];
  for (const s of samples) {
    for (const sensor of sensors) {
      const deltaC = s.channels[sensor.channel];
      if (deltaC !== undefined) out.push({ sensorId: sensor.id, ts: s.ts, deltaC });
    }
  }
  return out;
}

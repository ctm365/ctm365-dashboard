import type { Reading, SensorDef, Thresholds } from "./types";

/**
 * Sample electrical readings for showing the dashboard to prospects. The
 * scenario is fixed: most sensors run normal, one sits on watch, and one has
 * climbed into critical over the last hour. Values come from the sensor's
 * ID and the clock, not randomness, so every demo looks the same.
 *
 * Pure: no AWS or server-only imports, so it can be unit-tested.
 */

/** Matches a real datacard's reporting interval. */
export const SAMPLE_INTERVAL_MS = 15_000;
const WINDOW_POINTS = 360; // 90 minutes at 15 s

export type SampleRole = "normal" | "watch" | "critical";

/** With 3+ sensors: the last is critical and the one before is on watch. Fewer sensors stay calmer. */
export function sampleRoles(count: number): SampleRole[] {
  return Array.from({ length: count }, (_, i): SampleRole => {
    const fromEnd = count - 1 - i;
    if (count >= 3) return fromEnd === 0 ? "critical" : fromEnd === 1 ? "watch" : "normal";
    if (count === 2) return fromEnd === 0 ? "watch" : "normal";
    return "normal";
  });
}

/** Small stable hash, so each sensor gets its own level and wobble. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 0..1, different for each seed and step but the same every time. */
function jitter(seed: number, step: number): number {
  return (hash(`${seed}:${step}`) % 1000) / 1000;
}

/**
 * The sample value (Celsius rise) for one sensor at time ts. `climbEndsAt`
 * is when the critical sensor finishes climbing; before that it rises from
 * watch level, after it holds just above the critical limit.
 */
export function sampleValue(
  sensorId: string,
  role: SampleRole,
  ts: number,
  t: Thresholds,
  climbEndsAt: number,
): number {
  const seed = hash(sensorId);
  const step = Math.floor(ts / SAMPLE_INTERVAL_MS);
  const phase = (seed % 628) / 100;
  const slow = Math.sin((2 * Math.PI * ts) / (37 * 60_000) + phase);
  const fast = Math.sin((2 * Math.PI * ts) / (6 * 60_000) + phase * 1.7);
  const noise = jitter(seed, step) - 0.5;
  const band = t.criticalC - t.watchC;

  let value: number;
  if (role === "normal") {
    const base = t.watchC * (0.3 + ((seed >> 8) % 100) / 400); // 30-55% of the watch limit
    value = base + t.watchC * (0.06 * slow + 0.03 * fast + 0.04 * noise);
  } else if (role === "watch") {
    value = t.watchC + band * (0.45 + 0.12 * slow + 0.05 * fast + 0.06 * noise);
  } else {
    // Climb over the hour before climbEndsAt, from mid-watch to just over critical.
    const progress = Math.min(1, Math.max(0, 1 - (climbEndsAt - ts) / (60 * 60_000)));
    const eased = progress * progress * (3 - 2 * progress);
    const start = t.watchC + band * 0.35;
    const end = t.criticalC + band * 0.12;
    value = start + (end - start) * eased + band * (0.03 * fast + 0.04 * noise);
  }
  return Math.max(0, Math.round(value * 10) / 10);
}

/** The 90 minutes of sample readings up to `now`, on the 15 s grid, oldest first. */
export function sampleHistory(sensors: Pick<SensorDef, "id">[], t: Thresholds, now: number): Reading[] {
  const roles = sampleRoles(sensors.length);
  const last = Math.floor(now / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
  const out: Reading[] = [];
  for (let k = WINDOW_POINTS - 1; k >= 0; k--) {
    const ts = last - k * SAMPLE_INTERVAL_MS;
    sensors.forEach((s, i) => out.push({ sensorId: s.id, ts, deltaC: sampleValue(s.id, roles[i], ts, t, last) }));
  }
  return out;
}

/** One new sample reading per sensor at ts, continuing a history that ended at climbEndsAt. */
export function sampleTick(sensors: Pick<SensorDef, "id">[], t: Thresholds, ts: number, climbEndsAt: number): Reading[] {
  const roles = sampleRoles(sensors.length);
  return sensors.map((s, i) => ({ sensorId: s.id, ts, deltaC: sampleValue(s.id, roles[i], ts, t, climbEndsAt) }));
}

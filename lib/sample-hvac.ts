import type { HvacCycle, HvacHealth, HvacReading } from "./types";

/**
 * A sample Bard W42HC heat pump for demos and display while a real unit is
 * offline: cooling cycles of about 18 minutes on and 12 off, with air temps,
 * static pressure, single-phase 230 V power, and strap-on refrigerant line
 * probes, all following a gentle daily outdoor-temperature curve. Values come
 * from the clock, not randomness, so the page looks the same every time.
 * Pure, so it can be unit-tested.
 */

const MIN = 60_000;
const CYCLE_MIN = 30;
const ON_MIN = 18;

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Repeatable small jitter in -0.5..0.5 per minute and channel. */
function jitter(seed: number, minute: number) {
  const x = Math.sin(seed * 12.9898 + minute * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

/** Outdoor temperature: 72°F before dawn up to 94°F mid-afternoon (site time ~ UTC-8). */
function outdoorAt(ts: number) {
  const hour = (((ts / 3_600_000 - 8) % 24) + 24) % 24;
  return 83 + 11 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
}

export function sampleHvacAt(ts: number): HvacReading {
  const minute = Math.floor(ts / MIN);
  const inCycle = ((minute % CYCLE_MIN) + CYCLE_MIN) % CYCLE_MIN;
  const on = inCycle < ON_MIN;
  const oat = outdoorAt(ts);
  const hot = oat - 85; // load rises with outdoor temperature
  // Line temperatures settle over the first few minutes of a run.
  const settle = on ? Math.min(1, (inCycle + 1) / 4) : 0;
  const ret = 75 + 0.6 * Math.sin(minute / 47) + 0.2 * jitter(1, minute);
  const supply = on ? ret - (19 - 0.08 * hot) * settle - 0.6 * (1 - settle) : ret - 0.4;
  const kw = on ? 3.15 + 0.035 * hot + 0.03 * jitter(2, minute) : 0.05;
  const volts = 230.5 - (on ? 1.6 : 0) + 0.4 * jitter(3, minute);
  const pf = on ? 0.93 + 0.004 * jitter(4, minute) : 0.6;
  const amps = (kw * 1000) / (volts * pf);
  const slt = on ? 72 - (72 - (49 + 0.1 * hot)) * settle + 0.3 * jitter(5, minute) : 70 + 0.2 * jitter(5, minute);
  const dlt = on ? 85 + (172 + 1.1 * hot - 85) * settle + 0.6 * jitter(6, minute) : 88 - 0.03 * inCycle;
  const llt = on ? oat + 9 * settle + 0.3 * jitter(7, minute) : oat + 1;
  // Running total of kWh since midnight UTC, close enough for display.
  const dayMinute = ((minute % 1440) + 1440) % 1440;
  const energy = 1200 + (Math.floor(dayMinute / CYCLE_MIN) * ON_MIN + Math.min(ON_MIN, dayMinute % CYCLE_MIN)) * (3.15 / 60);

  return {
    ts: minute * MIN,
    supplyF: r(supply, 1),
    returnF: r(ret, 1),
    staticInwc: r(on ? 0.32 + 0.004 * jitter(8, minute) : 0.01, 3),
    voltageV: r(volts, 1),
    voltageAnV: r(volts / 2, 1),
    voltageAbV: r(volts, 1),
    currentA: r(on ? amps : 0.2, 1),
    currentAA: r(on ? amps : 0.2, 1),
    currentBA: r(on ? amps * 0.99 : 0.2, 1),
    powerW: r(kw * 1000, 0),
    powerFactor: r(pf, 2),
    frequencyHz: 60,
    energyKwh: r(energy, 1),
    suctionLineF: r(slt, 1),
    dischargeLineF: r(dlt, 1),
    liquidLineF: r(llt, 1),
    outdoorF: r(oat, 1),
  };
}

/** Readings for the last `hours`, oldest first: every minute up to a day, every 5 minutes beyond. */
export function sampleHvacReadings(now: number, hours: number): HvacReading[] {
  const step = hours > 24 ? 5 : 1;
  const end = Math.floor(now / MIN);
  const count = Math.floor((hours * 60) / step);
  return Array.from({ length: count }, (_, i) => sampleHvacAt((end - (count - 1 - i) * step) * MIN));
}

/** Today's sample compressor runs, all normal. */
function sampleCycles(dayStart: number, now: number): HvacCycle[] {
  const out: HvacCycle[] = [];
  const first = Math.ceil(dayStart / (CYCLE_MIN * MIN)) * CYCLE_MIN * MIN;
  for (let start = first; start < now; start += CYCLE_MIN * MIN) {
    const end = Math.min(start + ON_MIN * MIN, now);
    const running = end === now;
    out.push({
      start,
      end,
      runMin: Math.round((end - start) / MIN),
      cause: running ? "running" : "normal",
      detail: running ? "Running at the last reading." : "Normal run.",
    });
  }
  return out;
}

/** A healthy unit's health panel, with the refrigerant comparison and a flat charge trend. */
export function sampleHvacHealth(unitId: string, now: number, dayStart: number): HvacHealth {
  const current = sampleHvacAt(Math.floor(now / (CYCLE_MIN * MIN)) * CYCLE_MIN * MIN + 10 * MIN);
  const oat = current.outdoorF ?? 85;
  const hot = oat - 85;
  const expected = { slt: r(49 + 0.1 * hot, 1), dlt: r(172 + 1.1 * hot, 1), kw: r(3.15 + 0.035 * hot, 2), dt: r(19 - 0.08 * hot, 1) };
  const actual = {
    slt: r(expected.slt + 0.4, 1),
    dlt: r(expected.dlt - 1.2, 1),
    kw: r(expected.kw + 0.02, 2),
    dt: r(expected.dt - 0.3, 1),
  };
  const band = { slt: 3, dlt: 6, kw: 0.2, dt: 2 } as const;
  const range = Object.fromEntries(
    (Object.keys(expected) as (keyof typeof expected)[]).map((k) => [k, [r(expected[k] - band[k], 2), r(expected[k] + band[k], 2)]]),
  ) as Record<keyof typeof expected, [number, number]>;
  const day = (offset: number) => new Date(now - offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  return {
    unitId,
    status: "good",
    score: 100,
    categories: { cycling: "good", electrical: "good", airflow: "good", capacity: "good", refrigerant: "good", data: "good" },
    findings: [],
    baseline: { ready: true, days: 21, confidence: "high", refrigerantModel: true, refrigerantConfidence: "high", refrigerantSamples: 4200 },
    refrigerant: { actual, expected, range, outdoorF: r(oat, 1), chargeIndex: 0.1 },
    chargeHistory: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), value: r(0.15 * Math.sin(i * 1.7) - 0.05, 2) })),
    computedAt: new Date(Math.floor(now / (90 * MIN)) * 90 * MIN).toISOString(),
    dayStart,
    cycles: sampleCycles(dayStart, now),
  };
}

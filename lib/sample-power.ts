import type { PowerReading } from "./types";

/**
 * A sample 120/208 V three-phase panel for demos: steady voltage with a small
 * natural imbalance, and current that follows a building's daily load with a
 * little noise. Values come from the clock, not randomness, so every demo
 * looks the same. Pure, so it can be unit-tested.
 */

export const SAMPLE_POWER_INTERVAL_MS = 60_000;

function wobble(seed: number, ts: number, periodMin: number) {
  return Math.sin((2 * Math.PI * ts) / (periodMin * 60_000) + seed);
}

/** Small repeatable jitter in -0.5..0.5 for a phase and minute. */
function jitter(seed: number, ts: number) {
  const x = Math.sin(seed * 12.9898 + Math.floor(ts / 60_000) * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function samplePowerAt(ts: number): PowerReading {
  // Building load: higher mid-afternoon, lower overnight (site-local hour approximated from UTC-8).
  const hour = (((ts / 3_600_000 - 8) % 24) + 24) % 24;
  const load = 0.75 + 0.25 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  // Wobble scales with load, so the phases stay a believable few percent apart day and night.
  const phase = (base: number, seed: number) =>
    round(base * load * (1 + 0.025 * wobble(seed, ts, 23) + 0.012 * wobble(seed + 1, ts, 7) + 0.02 * jitter(seed, ts)), 1);
  const volts = (base: number, seed: number) =>
    round(base - 1.2 * (load - 0.75) * 4 + 0.6 * wobble(seed, ts, 41) + 0.4 * jitter(seed + 5, ts), 1);
  const an = volts(120.6, 1);
  const bn = volts(119.8, 2);
  const cn = volts(120.2, 3);
  // Line-to-line on a wye panel is about sqrt(3) times line-to-neutral.
  const ll = (a: number, b: number) => round(((a + b) / 2) * Math.sqrt(3), 1);
  return {
    ts,
    voltsAN: an,
    voltsBN: bn,
    voltsCN: cn,
    voltsAB: ll(an, bn),
    voltsBC: ll(bn, cn),
    voltsCA: ll(cn, an),
    ampsA: phase(153, 11),
    ampsB: phase(148, 23),
    ampsC: phase(143, 37),
  };
}

/** The last `minutes` of sample readings up to now, oldest first. */
export function samplePowerHistory(now: number, minutes = 90): PowerReading[] {
  const last = Math.floor(now / SAMPLE_POWER_INTERVAL_MS) * SAMPLE_POWER_INTERVAL_MS;
  return Array.from({ length: minutes }, (_, i) => samplePowerAt(last - (minutes - 1 - i) * SAMPLE_POWER_INTERVAL_MS));
}

/** Current imbalance in percent: (max - min) / average, across phases carrying current. */
export function imbalancePct(amps: (number | undefined)[]): number | undefined {
  const live = amps.filter((a): a is number => a !== undefined && a > 0.5);
  if (live.length < 2) return undefined;
  const avg = live.reduce((a, b) => a + b, 0) / live.length;
  return round(((Math.max(...live) - Math.min(...live)) / avg) * 100, 1);
}

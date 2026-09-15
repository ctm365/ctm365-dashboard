import { DEMO_SITE, HISTORY_LIMIT, STREAM_INTERVAL_MS } from "./fleet";
import type { Reading } from "./types";

/**
 * Simulated Exertherm readings. Values stay in the ranges seen on the real
 * gateway (about 1-13 °C rise normally) with occasional excursions, so the
 * dashboard's watch and critical states get exercised.
 *
 * This is replaced later by DynamoDB queries scoped to a customer_id.
 */

interface Profile {
  baseC: number;
  noiseC: number;
  /** Chance per tick of starting a heating excursion. */
  excursionChance: number;
  excursionPeakC: number;
}

const PROFILES: Record<string, Profile> = {
  "sensor-1": { baseC: 3.2, noiseC: 0.25, excursionChance: 0.002, excursionPeakC: 12 },
  "sensor-2": { baseC: 5.5, noiseC: 0.3, excursionChance: 0.002, excursionPeakC: 14 },
  "sensor-3": { baseC: 11.0, noiseC: 0.4, excursionChance: 0.004, excursionPeakC: 22 },
  "sensor-4": { baseC: 2.0, noiseC: 0.2, excursionChance: 0.006, excursionPeakC: 34 },
};

interface SensorState {
  valueC: number;
  /** Remaining ticks of the current excursion, 0 if none. */
  excursionTicks: number;
  excursionLength: number;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export class Simulator {
  private state = new Map<string, SensorState>();

  constructor(private sensorIds: string[] = DEMO_SITE.sensors.map((s) => s.id)) {
    for (const id of sensorIds) {
      const p = PROFILES[id] ?? PROFILES["sensor-1"];
      this.state.set(id, { valueC: p.baseC, excursionTicks: 0, excursionLength: 0 });
    }
  }

  private step(id: string): number {
    const p = PROFILES[id] ?? PROFILES["sensor-1"];
    const s = this.state.get(id)!;

    if (s.excursionTicks === 0 && Math.random() < p.excursionChance) {
      s.excursionLength = 60 + Math.floor(Math.random() * 90);
      s.excursionTicks = s.excursionLength;
    }

    let target = p.baseC;
    if (s.excursionTicks > 0) {
      // Rise then fall: a sine hump over the excursion.
      const progress = 1 - s.excursionTicks / s.excursionLength;
      target = p.baseC + (p.excursionPeakC - p.baseC) * Math.sin(progress * Math.PI);
      s.excursionTicks -= 1;
    }

    s.valueC += (target - s.valueC) * 0.15 + (Math.random() - 0.5) * 2 * p.noiseC;
    s.valueC = Math.max(0, s.valueC);
    return round1(s.valueC);
  }

  /** Readings for one tick at time ts. */
  tick(ts: number = Date.now()): Reading[] {
    return this.sensorIds.map((sensorId) => ({ sensorId, ts, deltaC: this.step(sensorId) }));
  }

  /** Backfilled history so the chart isn't empty on first load. */
  backfill(now: number = Date.now(), points = HISTORY_LIMIT): Reading[] {
    const out: Reading[] = [];
    for (let i = points - 1; i >= 0; i--) {
      out.push(...this.tick(now - i * STREAM_INTERVAL_MS));
    }
    return out;
  }
}

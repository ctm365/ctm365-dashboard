/**
 * Synthetic 1-minute telemetry for testing the analytics against known
 * patterns. Used by the tests only; it never writes anywhere.
 */

const DAY = 86_400_000;

/**
 * pattern: healthy | short-cycle | power-trip | overload | low-charge |
 *          filter | capacitor | meter-loss | start-attempts | imbalance
 */
export function simulateDay(dayStart, pattern = "healthy") {
  const p = {
    on: 18, off: 12, amps: 16, offAmps: 0.2, dt: 18, stat: 0.3, pf: 0.92, volts: 230, ampsB: 1,
    ...{
      "short-cycle": { on: 3, off: 4 },
      overload: { on: 4, off: 5 },
      "low-charge": { on: 4, off: 5, amps: 12.5, dt: 10 },
      filter: { stat: 0.48 },
      capacitor: { amps: 19.5, pf: 0.84 },
      "start-attempts": { on: 1, off: 6 },
      imbalance: { ampsB: 0.8 },
    }[pattern],
  };
  const rows = [];
  let minute = 0;
  let cycle = 0;
  while (minute < 1440) {
    for (let i = 0; i < p.on && minute < 1440; i++, minute++) {
      let amps = p.amps;
      if (pattern === "overload") amps = 16 + (6 * i) / Math.max(1, p.on - 1); // climbs to 22 A before tripping
      let volts = p.volts + Math.sin(minute / 50) * 2;
      // Power trip: every 4th cycle the voltage collapses in the last running minute.
      if (pattern === "power-trip" && cycle % 4 === 0 && i === p.on - 1) volts = 186;
      rows.push(row(dayStart, minute, { amps, ampsB: amps * p.ampsB, volts, dt: p.dt, stat: p.stat, pf: p.pf }));
    }
    const meterLoss = pattern === "meter-loss" && cycle % 6 === 0;
    for (let i = 0; i < p.off && minute < 1440; i++, minute++) {
      const r = row(dayStart, minute, { amps: p.offAmps, ampsB: p.offAmps, volts: p.volts, dt: 0.4, stat: 0.02, pf: 0.5 });
      if (meterLoss && i < 3) {
        // The meter is line-powered: during an outage only the ADAM temperatures arrive.
        for (const k of ["current_a", "current_a_a", "current_b_a", "voltage_v", "power_w", "power_factor", "energy_kwh"]) delete r[k];
      }
      rows.push(r);
    }
    cycle++;
  }
  return rows;
}

function row(dayStart, minute, { amps, ampsB, volts, dt, stat, pf }) {
  const ts = new Date(dayStart + minute * 60_000).toISOString().slice(0, 17) + "00Z";
  const supply = 72 - dt / 2;
  return {
    timestamp: ts,
    current_a: Math.max(amps, ampsB),
    current_a_a: amps,
    current_b_a: ampsB,
    voltage_v: volts,
    power_w: amps * volts * pf,
    power_factor: pf,
    air_supply_temp_f: supply,
    air_return_temp_f: supply + dt,
    static_pressure_inwc: stat,
    energy_kwh: (amps * volts * pf * minute) / 60_000,
  };
}

export const dayStartUtc = (y, m, d) => Date.UTC(y, m - 1, d);
export { DAY };

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRefrigerantModel,
  chargeIndex,
  coolingDegreeDays,
  dayResiduals,
  energyFinding,
  energyModel,
  lineLimits,
  matchSignature,
  refrigerantFindings,
  refrigerantSamples,
} from "./refrigerant.mjs";

/**
 * A synthetic cooling unit: outdoor 70-100°F through the day, return air
 * around 75°F, and line temps / kW / ΔT that follow them like a real
 * packaged unit. A fault shifts readings by its typical offsets x severity.
 */
const FAULTS = {
  none: [0, 0, 0, 0],
  "low-charge": [6, 15, -0.35, -4],
  overcharge: [-4, 3, 0.4, -1.5],
  "low-airflow": [-6, -4, -0.2, 4],
  condenser: [0, 12, 0.45, -1.2],
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2; // -1..1
}

function samples({ days = 1, fault = "none", severity = 1, seed = 1, perDay = 200 }) {
  const r = rng(seed);
  const off = FAULTS[fault].map((x) => x * severity);
  const out = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < perDay; i++) {
      const oat = 85 + 15 * Math.sin((2 * Math.PI * i) / perDay) + r() * 2;
      const rat = 75 + r() * 1.5;
      const slt = 50 + 0.1 * (oat - 85) + 0.3 * (rat - 75) + r() * 0.5 + off[0];
      const dlt = 170 + 1.1 * (oat - 85) + 0.2 * (rat - 75) + r() * 1.5 + off[1];
      const kw = 3.2 + 0.035 * (oat - 85) + 0.01 * (rat - 75) + r() * 0.05 + off[2];
      const dt = 19 - 0.08 * (oat - 85) + 0.25 * (rat - 75) + r() * 0.4 + off[3];
      out.push([oat, rat, slt, dlt, kw, dt, "c"]);
    }
  }
  return out;
}

const model = buildRefrigerantModel(samples({ days: 10, seed: 7 }));

test("the model learns the unit's normal and expects healthy days", () => {
  assert.ok(model.cooling);
  assert.deepEqual(model.cooling.terms, ["outdoor"]); // return air barely moves, so outdoor carries the model
  assert.ok(Math.abs(model.cooling.coef.dlt.slopes[0] - 1.1) < 0.1, "learns discharge rises ~1.1°F per °F outdoor");
  const healthy = dayResiduals(model, samples({ seed: 99 }));
  for (const v of Object.values(healthy.z)) assert.ok(Math.abs(v) < 1, `healthy residual ${v}`);
  assert.equal(matchSignature(healthy.z), undefined);
});

for (const fault of ["low-charge", "overcharge", "low-airflow", "condenser"]) {
  test(`recognises the ${fault} pattern`, () => {
    const day = dayResiduals(model, samples({ fault, seed: 42 }));
    assert.equal(matchSignature(day.z)?.code, fault);
  });
}

test("hot weather alone is not a fault: the model expects higher discharge temps on hot days", () => {
  const hot = samples({ seed: 5 }).map((s) => {
    const oat = s[0] + 10;
    return [oat, s[1], s[2] + 1, s[3] + 11, s[4] + 0.35, s[5] - 0.8, "c"];
  });
  assert.equal(matchSignature(dayResiduals(model, hot).z), undefined);
});

test("a mild low-charge pattern is a watch, a severe one is an action", () => {
  const level = (severity) =>
    refrigerantFindings({ rows: [], cycles: [], samples: samples({ fault: "low-charge", severity, seed: 3 }), model }).found.find((f) => f.code === "low-charge")?.level;
  assert.equal(level(0.25), undefined);
  assert.equal(level(0.4), "watch");
  assert.equal(level(0.6), "elevated");
  assert.equal(level(1), "action");
});

test("a slow leak shows as a rising charge index before any single day is alarming", () => {
  const recentIndex = [];
  let last;
  for (let d = 0; d < 14; d++) {
    const day = refrigerantFindings({ rows: [], cycles: [], samples: samples({ fault: "low-charge", severity: 0.02 * d, seed: 100 + d }), model, recentIndex });
    last = day;
    recentIndex.push({ x: d, y: day.residuals.chargeIndex });
  }
  assert.ok(last.found.some((f) => f.code === "charge-drift"), JSON.stringify(last.found.map((f) => f.code)));
  assert.ok(!last.found.some((f) => f.code === "low-charge"), "no single day is a low-charge finding yet");
});

test("absolute limits: hot discharge, freezing coil, and a compressor that isn't pumping", () => {
  const cycles = [{ start: 0, end: 60 * 60_000 }];
  const rows = (fn) => Array.from({ length: 60 }, (_, i) => ({ ts: i * 60_000, supplyF: 55, returnF: 75, ...fn(i) }));
  const codes = (r) => lineLimits(r, cycles).map((f) => `${f.code}:${f.level}`);
  assert.deepEqual(codes(rows(() => ({ sltF: 50, dltF: 230 }))), ["dlt-high:elevated"]);
  assert.deepEqual(codes(rows(() => ({ sltF: 50, dltF: 260 }))), ["dlt-high:action"]);
  assert.deepEqual(codes(rows(() => ({ sltF: 30, dltF: 160 }))), ["coil-freezing:elevated"]);
  assert.deepEqual(codes(rows(() => ({ sltF: 70, dltF: 85 }))), ["no-compression:action"]);
  assert.deepEqual(codes(rows(() => ({ sltF: 50, dltF: 175 }))), []);
});

test("samples come only from settled running minutes with every reading present", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ ts: i * 60_000, outdoorF: 90, returnF: 75, supplyF: 56, sltF: 50, dltF: 175, powerW: 3200 }));
  rows[10].sltF = undefined;
  const s = refrigerantSamples(rows, [{ start: 0, end: 20 * 60_000 }]);
  // Minutes 5-19 are settled; every 3rd kept (5, 8, 11, 14, 17), minute 11 is fine, minute 10 isn't sampled anyway.
  assert.equal(s.length, 5);
  assert.deepEqual(s[0], [90, 75, 50, 175, 3.2, 19, "c"]);
});

test("weather-adjusted energy flags a unit using more power than the weather explains", () => {
  const base = Array.from({ length: 10 }, (_, i) => ({ cdd: 10 + i * 2, kwh: 20 + 2.5 * (10 + i * 2) }));
  const m = energyModel(base);
  assert.ok(Math.abs(m.perCdd - 2.5) < 0.01);
  assert.equal(energyFinding(m, { cdd: 20, kwh: 72 }), undefined); // expected 70
  assert.equal(energyFinding(m, { cdd: 20, kwh: 90 })?.level, "watch");
  assert.equal(energyFinding(m, { cdd: 20, kwh: 105 })?.level, "elevated");
  assert.equal(energyFinding(m, { cdd: 2, kwh: 90 }), undefined, "mild days aren't judged");
  assert.equal(coolingDegreeDays([70, 100]), 20);
  assert.ok(chargeIndex({ slt: 2, dlt: 2, kw: -2, dt: -2 }) > 3.9);
});

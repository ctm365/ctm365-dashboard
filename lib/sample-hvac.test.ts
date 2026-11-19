import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleHvacAt, sampleHvacHealth, sampleHvacReadings } from "./sample-hvac.ts";

const NOW = Date.UTC(2026, 10, 19, 22, 7, 30); // 2:07 PM Pacific
const DAY_START = Date.UTC(2026, 10, 19, 8, 0, 0);

test("readings: one per minute up to a day, every 5 minutes beyond, the same every time", () => {
  assert.equal(sampleHvacReadings(NOW, 6).length, 360);
  assert.equal(sampleHvacReadings(NOW, 24).length, 1440);
  const week = sampleHvacReadings(NOW, 168);
  assert.equal(week.length, 2016);
  assert.equal(week[1].ts - week[0].ts, 5 * 60_000);
  assert.deepEqual(sampleHvacReadings(NOW, 6), sampleHvacReadings(NOW, 6));
});

test("a settled cooling run looks like a healthy Bard with line probes", () => {
  const minute = Math.floor(NOW / 60_000);
  const runStart = minute - (minute % 30); // runs start on the half hour
  const r = sampleHvacAt((runStart + 10) * 60_000);
  const dt = r.returnF! - r.supplyF!;
  assert.ok(dt > 15 && dt < 22, `delta-T ${dt}`);
  assert.ok(r.suctionLineF! > 40 && r.suctionLineF! < 60, `suction ${r.suctionLineF}`);
  assert.ok(r.dischargeLineF! > 150 && r.dischargeLineF! < 200, `discharge ${r.dischargeLineF}`);
  assert.ok(r.dischargeLineF! - r.suctionLineF! > 90, "healthy compressor lift");
  assert.ok(r.currentA! > 10 && r.currentA! < 20, `amps ${r.currentA}`);
  assert.ok(r.voltageV! > 220 && r.voltageV! < 240, `volts ${r.voltageV}`);
  assert.ok(r.staticInwc! > 0.25 && r.staticInwc! < 0.4);
  const off = sampleHvacAt((runStart + 25) * 60_000);
  assert.ok(off.currentA! < 1, "compressor off between runs");
});

test("sample health is Good, with readings inside their normal ranges and a flat charge trend", () => {
  const h = sampleHvacHealth("bard-01", NOW, DAY_START);
  assert.equal(h.status, "good");
  assert.equal(h.findings.length, 0);
  for (const k of ["slt", "dlt", "kw", "dt"] as const) {
    const [lo, hi] = h.refrigerant!.range[k];
    assert.ok(h.refrigerant!.actual[k] >= lo && h.refrigerant!.actual[k] <= hi, `${k} in range`);
  }
  assert.equal(h.chargeHistory.length, 14);
  assert.ok(h.chargeHistory.every((p) => Math.abs(p.value) < 0.5));
  assert.ok(h.cycles.length > 20 && h.cycles.every((c) => c.cause === "normal" || c.cause === "running"));
});

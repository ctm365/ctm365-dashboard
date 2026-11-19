import assert from "node:assert/strict";
import { test } from "node:test";
import { imbalancePct, samplePowerAt, samplePowerHistory } from "./sample-power.ts";

const NOW = Date.UTC(2026, 10, 19, 22, 0, 30);

test("sample history is 90 one-minute readings, the same every time", () => {
  const a = samplePowerHistory(NOW);
  assert.equal(a.length, 90);
  assert.ok(a.every((r, i) => i === 0 || r.ts - a[i - 1].ts === 60_000));
  assert.deepEqual(samplePowerHistory(NOW), a);
});

test("sample values look like a healthy 120/208 V three-phase panel", () => {
  for (const r of samplePowerHistory(NOW, 24 * 60)) {
    for (const v of [r.voltsAN, r.voltsBN, r.voltsCN]) assert.ok(v! > 114 && v! < 126, `L-N ${v}`);
    for (const v of [r.voltsAB, r.voltsBC, r.voltsCA]) assert.ok(v! > 198 && v! < 218, `L-L ${v}`);
    for (const a of [r.ampsA, r.ampsB, r.ampsC]) assert.ok(a! > 60 && a! < 220, `amps ${a}`);
    const imb = imbalancePct([r.ampsA, r.ampsB, r.ampsC])!;
    assert.ok(imb > 1 && imb < 15, `imbalance ${imb}`); // healthy demo: never trips the 20% warning
  }
  assert.ok(samplePowerAt(NOW).ampsA! > samplePowerAt(NOW).ampsC!, "phase A carries the most load");
});

test("imbalance ignores phases with no current", () => {
  assert.equal(imbalancePct([100, 100, 100]), 0);
  assert.equal(imbalancePct([110, 100, 90]), 20);
  assert.equal(imbalancePct([100, 0, undefined]), undefined);
});

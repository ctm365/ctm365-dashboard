import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_INTERVAL_MS, sampleHistory, sampleRoles, sampleTick, sampleValue } from "./sample-data.ts";

const T = { watchC: 10, criticalC: 25 };
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const sensors = ["s1", "s2", "s3", "s4", "s5"].map((id) => ({ id }));

test("roles: last sensor critical, the one before on watch, the rest normal", () => {
  assert.deepEqual(sampleRoles(5), ["normal", "normal", "normal", "watch", "critical"]);
  assert.deepEqual(sampleRoles(2), ["normal", "watch"]);
  assert.deepEqual(sampleRoles(1), ["normal"]);
  assert.deepEqual(sampleRoles(0), []);
});

test("history is 90 minutes on the 15 s grid, the same every time", () => {
  const a = sampleHistory(sensors, T, NOW);
  assert.equal(a.length, 360 * sensors.length);
  assert.ok(a.every((r) => r.ts % SAMPLE_INTERVAL_MS === 0));
  assert.deepEqual(sampleHistory(sensors, T, NOW), a);
});

test("every value stays in its band, so the scenario always reads normal / watch / critical", () => {
  const history = sampleHistory(sensors, T, NOW);
  const last = Math.max(...history.map((r) => r.ts));
  for (const r of history) {
    if (["s1", "s2", "s3"].includes(r.sensorId)) assert.ok(r.deltaC >= 0 && r.deltaC < T.watchC, `normal ${r.deltaC}`);
    if (r.sensorId === "s4") assert.ok(r.deltaC >= T.watchC && r.deltaC < T.criticalC, `watch ${r.deltaC}`);
  }
  const critical = history.filter((r) => r.sensorId === "s5");
  assert.ok(critical[0].deltaC < T.criticalC, "starts below critical");
  assert.ok(critical.at(-1)!.deltaC >= T.criticalC, "ends critical");
  // Live ticks after the history keep the critical sensor critical.
  for (let i = 1; i <= 20; i++) {
    const tick = sampleTick(sensors, T, last + i * SAMPLE_INTERVAL_MS, last);
    assert.ok(tick[4].deltaC >= T.criticalC);
    assert.equal(tick.length, 5);
  }
});

test("follows the customer's own thresholds", () => {
  const t = { watchC: 5, criticalC: 8 };
  assert.ok(sampleValue("x", "normal", NOW, t, NOW) < 5);
  const w = sampleValue("x", "watch", NOW, t, NOW);
  assert.ok(w >= 5 && w < 8);
  assert.ok(sampleValue("x", "critical", NOW, t, NOW) >= 8);
});

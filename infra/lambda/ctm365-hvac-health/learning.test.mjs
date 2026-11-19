import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBaseline, confidenceFor, findings } from "./analytics.mjs";
import { learnFinishedDays, rebuildBaseline } from "./index.mjs";
import { addRefSamples, buildRefrigerantModel, emptyRefStats, modelFromStats } from "./refrigerant.mjs";

const metrics = (o = {}) => ({ runtimeMin: 300, ampsRun: 16, deltaTF: 18, staticInwc: 0.3, pf: 0.92, volts: 230, kwh: 40, cdd: 10, ...o });
/** A day record as the job stores it, finalized shortly after its own midnight (Pacific). */
const dayItem = (day, o = {}) => ({
  day,
  metrics: metrics(o.metrics),
  findings: o.findings ?? [],
  refSamples: o.refSamples ?? [],
  computedAt: o.computedAt ?? new Date(Date.parse(`${day}T08:00:00Z`) + 26 * 3_600_000).toISOString(),
});

test("analytics are usable from the first day with runtime, with growing confidence", () => {
  assert.equal(buildBaseline([]).ready, false);
  const one = buildBaseline([{ day: "2026-12-01", metrics: metrics() }]);
  assert.equal(one.ready, true);
  assert.equal(one.confidence, "low");
  assert.equal(confidenceFor(3), "medium");
  assert.equal(confidenceFor(7), "high");
  assert.equal(confidenceFor(400), "high");
});

test("each finished day is learned once; today and unfinished days wait", () => {
  const baseline = {};
  const days = [
    dayItem("2026-12-01"),
    dayItem("2026-12-02"),
    dayItem("2026-12-03", { computedAt: "2026-12-03T20:00:00Z" }), // analysed before its midnight: not final
    dayItem("2026-12-04"),
  ];
  assert.equal(learnFinishedDays(baseline, days, "2026-12-04"), 2);
  assert.deepEqual(baseline.dayMetrics.map((d) => d.day), ["2026-12-01", "2026-12-02"]);
  assert.equal(baseline.lastLearnedDay, "2026-12-02");
  assert.equal(learnFinishedDays(baseline, days, "2026-12-04"), 0, "nothing learned twice");
});

test("days with serious unit findings are not learned as normal; power problems and data gaps still are", () => {
  const baseline = {};
  const days = [
    dayItem("2026-12-01", { findings: [{ category: "refrigerant", level: "elevated" }] }),
    dayItem("2026-12-02", { findings: [{ category: "airflow", level: "watch" }] }),
    dayItem("2026-12-03", { findings: [{ category: "electrical", level: "elevated" }, { category: "data", level: "action" }] }),
  ];
  learnFinishedDays(baseline, days, "2026-12-09");
  assert.deepEqual(baseline.dayMetrics.map((d) => d.day), ["2026-12-02", "2026-12-03"]);
  assert.equal(baseline.lastLearnedDay, "2026-12-03");
});

test("Start learning again: only days from the reset on are learned", () => {
  const baseline = { resetAt: "2026-12-03" };
  learnFinishedDays(baseline, [dayItem("2026-12-01"), dayItem("2026-12-03"), dayItem("2026-12-04")], "2026-12-09");
  assert.deepEqual(baseline.dayMetrics.map((d) => d.day), ["2026-12-03", "2026-12-04"]);
  const b = rebuildBaseline(baseline);
  assert.equal(b.ready, true);
  assert.equal(b.days, 2);
  assert.equal(b.confidence, "low");
});

/** Synthetic cooling samples [oat, rat, slt, dlt, kw, dt, "c"]. */
function samples(n, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
  return Array.from({ length: n }, (_, i) => {
    const oat = 85 + 15 * Math.sin(i / 20) + r();
    const rat = 75 + r();
    return [oat, rat, 50 + 0.1 * (oat - 85) + r() * 0.5, 170 + 1.1 * (oat - 85) + r(), 3.2 + 0.035 * (oat - 85) + r() * 0.04, 19 - 0.08 * (oat - 85) + r() * 0.3, "c"];
  });
}

test("refrigerant running totals give the same model as fitting everything at once", () => {
  const a = samples(400, 3);
  const b = samples(500, 9);
  const stepwise = modelFromStats(addRefSamples(addRefSamples(emptyRefStats(), a), b));
  const once = buildRefrigerantModel([...a, ...b]);
  for (const t of ["slt", "dlt", "kw", "dt"]) {
    assert.ok(Math.abs(stepwise.cooling.coef[t].intercept - once.cooling.coef[t].intercept) < 1e-6);
    assert.ok(Math.abs(stepwise.cooling.coef[t].slopes[0] - once.cooling.coef[t].slopes[0]) < 1e-9);
  }
  assert.ok(Math.abs(stepwise.cooling.coef.dlt.slopes[0] - 1.1) < 0.05);
});

test("the refrigerant model starts after about 3 hours of running and gains confidence with data", () => {
  assert.equal(buildRefrigerantModel(samples(59)).cooling, undefined);
  assert.equal(buildRefrigerantModel(samples(60)).cooling.confidence, "low");
  assert.equal(buildRefrigerantModel(samples(300)).cooling.confidence, "medium");
  assert.equal(buildRefrigerantModel(samples(1500)).cooling.confidence, "high");
});

test("with little history, a change has to be bigger before it becomes a finding", () => {
  const today = { metrics: metrics({ staticInwc: 0.4 }) }; // +33% static
  const at = (confidence) =>
    findings({ today, baseline: { ready: true, confidence, metrics: { staticInwc: 0.3 } }, lastSeen: 1, now: 1 }).map((f) => `${f.code}:${f.level}`);
  assert.deepEqual(at("high"), ["static-rising:watch"]);
  assert.deepEqual(at("low"), [], "+33% isn't enough on day one (needs +37.5%)");
});

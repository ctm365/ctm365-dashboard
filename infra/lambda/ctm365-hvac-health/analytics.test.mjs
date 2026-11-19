import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBaseline, dayMetrics, findings, health, toRow } from "./analytics.mjs";
import { DAY, dayStartUtc, simulateDay } from "./simulate.mjs";

const D0 = dayStartUtc(2026, 6, 1);
const rowsFor = (pattern, day = 0) => simulateDay(D0 + day * DAY, pattern).map(toRow);
const metricsFor = (pattern, baseline, day = 0) => dayMetrics(rowsFor(pattern, day), baseline);

/** Ten healthy days give the unit a ready baseline. */
const baseline = buildBaseline(
  Array.from({ length: 10 }, (_, i) => ({ day: `2026-06-${String(i + 1).padStart(2, "0")}`, ...metricsFor("healthy", undefined, i) })),
);

function evaluate(pattern) {
  const today = metricsFor(pattern, baseline, 20);
  const found = findings({ today, baseline, lastSeen: today.metrics.lastTs, now: today.metrics.lastTs + 60_000 });
  return { today, found, codes: found.map((f) => `${f.code}:${f.level}`), ...health(found) };
}

test("baseline learns the unit's normal from healthy days", () => {
  assert.equal(baseline.ready, true);
  assert.equal(baseline.days, 10);
  assert.equal(baseline.metrics.ampsRun, 16);
  assert.equal(baseline.metrics.deltaTF, 18);
  assert.equal(baseline.metrics.staticInwc, 0.3);
  assert.ok(Math.abs(baseline.metrics.volts - 230) < 2);
});

test("a healthy unit has normal cycles and no findings", () => {
  const { today, found, status, score } = evaluate("healthy");
  assert.equal(today.metrics.cycles, 48);
  assert.ok(today.cycles.filter((c) => !c.open).every((c) => c.cause === "normal"));
  assert.deepEqual(found, []);
  assert.equal(status, "good");
  assert.equal(score, 100);
});

test("short cycling with normal current and voltage is flagged as short cycling, not a fault", () => {
  const { today, codes } = evaluate("short-cycle");
  assert.ok(today.metrics.maxCyclesPerHour >= 8);
  assert.ok(today.cycles.some((c) => c.cause === "short-cycle"));
  assert.ok(!today.cycles.some((c) => c.cause === "short-overload" || c.cause === "power"));
  assert.ok(codes.includes("short-cycling:action"));
});

test("a shutdown on collapsing voltage is a power problem, not a unit fault", () => {
  const { today, codes, categories } = evaluate("power-trip");
  const power = today.cycles.filter((c) => c.cause === "power");
  assert.equal(power.length, 12); // every 4th of 48 cycles
  assert.match(power[0].detail, /bad power, not a fault in the unit/);
  assert.ok(codes.includes("power-stops:elevated"));
  assert.equal(categories.cycling, "good");
});

test("losing meter power while running is classified as a power loss", () => {
  const { today } = evaluate("meter-loss");
  assert.ok(today.cycles.some((c) => c.cause === "meter-power-loss"));
  assert.ok(today.metrics.powerStops > 0);
});

test("short runs with climbing current are overload trips", () => {
  const { today, codes } = evaluate("overload");
  assert.ok(today.metrics.overloadStops >= 3);
  assert.ok(codes.includes("overload-trips:action"));
});

test("short runs with low current and a weak temperature drop suggest low refrigerant", () => {
  const { today, codes } = evaluate("low-charge");
  assert.ok(today.metrics.lowChargeStops >= 3);
  assert.ok(codes.includes("low-charge-pattern:elevated"));
});

test("one-minute runs are start attempts", () => {
  const { today, codes } = evaluate("start-attempts");
  assert.ok(today.metrics.startAttempts >= 3);
  assert.ok(codes.includes("start-attempts:action"));
});

test("rising static pressure against the baseline is airflow restriction", () => {
  const { codes, categories } = evaluate("filter");
  assert.ok(codes.includes("static-rising:elevated"));
  assert.equal(categories.airflow, "elevated");
});

test("higher current with a falling power factor points at the run capacitor", () => {
  const { codes } = evaluate("capacitor");
  assert.ok(codes.includes("capacitor:elevated"));
});

test("phase imbalance over 20% is an action item", () => {
  // Phase B at 80% of phase A: (16 - 12.8) / 14.4 = 22%.
  const { codes } = evaluate("imbalance");
  assert.ok(codes.includes("imbalance:action"));
});

test("a unit with no recent data is flagged offline", () => {
  const today = metricsFor("healthy", baseline, 20);
  const found = findings({ today, baseline, lastSeen: today.metrics.lastTs, now: today.metrics.lastTs + 5 * 3_600_000 });
  assert.deepEqual(found.map((f) => `${f.code}:${f.level}`), ["offline:action"]);
});

test("without a baseline, only absolute rules apply", () => {
  const today = metricsFor("filter", undefined, 20);
  const found = findings({ today, baseline: undefined, lastSeen: today.metrics.lastTs, now: today.metrics.lastTs });
  assert.deepEqual(found, [], "0.48 in. w.c. is within the 0.5 rating, and nothing to compare against yet");
});

test("a problem seen on most of the last 7 days is raised one level", () => {
  const today = metricsFor("filter", baseline, 20);
  const recent = Array.from({ length: 6 }, () => ({ findings: [{ code: "static-rising" }] }));
  const found = findings({ today, recent, baseline, lastSeen: today.metrics.lastTs, now: today.metrics.lastTs });
  assert.equal(found.find((f) => f.code === "static-rising").level, "action");
});

test("health score drops by finding level", () => {
  assert.deepEqual(health([]), { status: "good", score: 100, categories: { cycling: "good", electrical: "good", airflow: "good", capacity: "good", refrigerant: "good", data: "good" } });
  const h = health([{ category: "airflow", level: "elevated" }, { category: "electrical", level: "watch" }]);
  assert.equal(h.score, 80);
  assert.equal(h.status, "elevated");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigInputError,
  THRESHOLD_MAX_C,
  isTempUnit,
  normalizeThresholds,
  parseTempUnit,
  parseThresholds,
} from "./validation.ts";

const FALLBACK = { watchC: 10, criticalC: 25 };

test("parseTempUnit accepts only F or C", () => {
  assert.equal(parseTempUnit("F"), "F");
  assert.equal(parseTempUnit("C"), "C");
  for (const bad of ["f", "K", "", null, undefined, 5]) {
    assert.throws(() => parseTempUnit(bad), ConfigInputError);
  }
  assert.equal(isTempUnit("F"), true);
  assert.equal(isTempUnit("x"), false);
});

test("parseThresholds accepts a valid pair", () => {
  assert.deepEqual(parseThresholds(10, 25), { watchC: 10, criticalC: 25 });
  assert.deepEqual(parseThresholds(0.5, THRESHOLD_MAX_C), { watchC: 0.5, criticalC: THRESHOLD_MAX_C });
});

test("parseThresholds rejects non-numbers, non-positive watch, critical <= watch, and critical above the cap", () => {
  const bad: [unknown, unknown][] = [
    ["10", 25],
    [10, "25"],
    [NaN, 25],
    [10, Infinity],
    [undefined, 25],
    [0, 25],
    [-5, 25],
    [10, 10],
    [10, 9],
    [10, THRESHOLD_MAX_C + 1],
  ];
  for (const [w, c] of bad) {
    assert.throws(() => parseThresholds(w, c), ConfigInputError, `${String(w)}, ${String(c)}`);
  }
});

test("normalizeThresholds keeps valid stored values and falls back for anything missing or invalid", () => {
  assert.deepEqual(normalizeThresholds({ watchC: 8, criticalC: 20 }, FALLBACK), { watchC: 8, criticalC: 20 });
  for (const stored of [undefined, null, {}, "x", { watchC: 8 }, { watchC: 30, criticalC: 20 }, { watchC: -1, criticalC: 5 }, { watchC: "8", criticalC: "20" }]) {
    assert.deepEqual(normalizeThresholds(stored, FALLBACK), FALLBACK);
  }
});

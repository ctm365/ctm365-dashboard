import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THRESHOLDS, convertRise, riseToC, statusFor } from "./fleet.ts";

test("default thresholds are exactly the old 18°F watch / 45°F critical", () => {
  assert.equal(convertRise(DEFAULT_THRESHOLDS.watchC, "F"), 18);
  assert.equal(convertRise(DEFAULT_THRESHOLDS.criticalC, "F"), 45);
});

test("statusFor: below watch is normal, watch up to critical is watch, critical and above is critical", () => {
  const t = { watchC: 10, criticalC: 25 };
  assert.equal(statusFor(0, t), "normal");
  assert.equal(statusFor(9.99, t), "normal");
  assert.equal(statusFor(10, t), "watch");
  assert.equal(statusFor(24.99, t), "watch");
  assert.equal(statusFor(25, t), "critical");
  assert.equal(statusFor(80, t), "critical");
});

test("statusFor follows custom thresholds and defaults when none are given", () => {
  assert.equal(statusFor(6, { watchC: 5, criticalC: 8 }), "watch");
  assert.equal(statusFor(6), "normal");
  assert.equal(statusFor(12), "watch");
});

test("convertRise scales a rise by 1.8 for °F with no +32 offset, and is the identity for °C", () => {
  assert.equal(convertRise(10, "F"), 18);
  assert.equal(convertRise(0, "F"), 0);
  assert.equal(convertRise(10, "C"), 10);
});

test("riseToC inverts convertRise, so typing the displayed number stores the same rise", () => {
  assert.equal(riseToC(18, "F"), 10);
  assert.equal(riseToC(45, "F"), 25);
  assert.equal(riseToC(10, "C"), 10);
  for (const c of [3.5, 10, 12.25, 25, 100]) {
    assert.equal(riseToC(convertRise(c, "F"), "F"), c);
  }
});

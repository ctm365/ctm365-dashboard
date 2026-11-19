import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigInputError,
  THRESHOLD_MAX_C,
  adminCustomerPath,
  isValidCustomerId,
  isTempUnit,
  normalizeDatacardId,
  normalizeServices,
  normalizeThresholds,
  parseCustomerId,
  parseDatacardId,
  parseEmail,
  parseHvacUnitId,
  parseServices,
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

test("parseServices accepts only true/false for both services", () => {
  assert.deepEqual(parseServices({ electrical: true, hvac: false }), { electrical: true, hvac: false });
  assert.deepEqual(parseServices({ electrical: false, hvac: false }), { electrical: false, hvac: false });
  const bad: unknown[] = [null, undefined, {}, { electrical: true }, { electrical: "true", hvac: false }, { electrical: 1, hvac: 0 }];
  for (const value of bad) assert.throws(() => parseServices(value), ConfigInputError);
});

test("parseServices drops unknown fields", () => {
  assert.deepEqual(parseServices({ electrical: true, hvac: true, admin: true }), { electrical: true, hvac: true });
});

test("normalizeServices keeps saved services, including both off", () => {
  const setup = { hasElectricalSetup: true, hasHvacSetup: true };
  assert.deepEqual(normalizeServices({ electrical: false, hvac: true }, setup), { electrical: false, hvac: true });
  assert.deepEqual(normalizeServices({ electrical: false, hvac: false }, setup), { electrical: false, hvac: false });
});

test("normalizeServices gives older items the services they already have set up", () => {
  assert.deepEqual(normalizeServices(undefined, { hasElectricalSetup: true, hasHvacSetup: false }), {
    electrical: true,
    hvac: false,
  });
  assert.deepEqual(normalizeServices(undefined, { hasElectricalSetup: true, hasHvacSetup: true }), {
    electrical: true,
    hvac: true,
  });
  assert.deepEqual(normalizeServices({ electrical: "yes" }, { hasElectricalSetup: false, hasHvacSetup: true }), {
    electrical: false,
    hvac: true,
  });
});

test("customer IDs accept capitals, spaces and symbols", () => {
  for (const id of ["Mobile Modular", "demo", "ACME Foods #2", "O'Brien & Sons", "Café-Nord/West", "12"]) {
    assert.equal(parseCustomerId(id), id);
    assert.equal(isValidCustomerId(id), true);
  }
});

test("customer IDs are trimmed, and rejected when too short, too long, or holding control characters", () => {
  assert.equal(parseCustomerId("  Mobile Modular  "), "Mobile Modular");
  assert.equal(isValidCustomerId(" demo"), false, "stored IDs never have edge spaces");
  const bad: unknown[] = ["", " ", "a", "  a  ", "x".repeat(65), "tab\there", "line\nbreak", null, 42];
  for (const value of bad) assert.throws(() => parseCustomerId(value), ConfigInputError);
  assert.equal(parseCustomerId("x".repeat(64)).length, 64);
});

test("customer IDs are case-sensitive", () => {
  assert.notEqual(parseCustomerId("Demo"), parseCustomerId("demo"));
});

test("adminCustomerPath encodes characters that would break the URL", () => {
  assert.equal(adminCustomerPath("demo"), "/admin/demo");
  assert.equal(adminCustomerPath("Mobile Modular"), "/admin/Mobile%20Modular");
  assert.equal(adminCustomerPath("a/b?c#d"), "/admin/a%2Fb%3Fc%23d");
  assert.equal(decodeURIComponent(adminCustomerPath("50% Off").slice("/admin/".length)), "50% Off");
});

test("parseHvacUnitId accepts MQTT-safe IDs and rejects the rest", () => {
  for (const id of ["bard-01", "Bard_W42HC.2", "a"]) assert.equal(parseHvacUnitId(id), id);
  assert.equal(parseHvacUnitId("  bard-01 "), "bard-01");
  for (const bad of ["", "bard 01", "bard/01", "bard#", "x".repeat(65), null]) {
    assert.throws(() => parseHvacUnitId(bad), ConfigInputError);
  }
});

test("parseDatacardId accepts topic-safe IDs, clears on blank, and rejects the rest", () => {
  assert.equal(parseDatacardId("exertherm-07"), "exertherm-07");
  assert.equal(parseDatacardId("  gt200-0042 "), "gt200-0042");
  assert.equal(parseDatacardId(""), null);
  assert.equal(parseDatacardId("   "), null);
  for (const bad of ["exertherm 07", "a/b", "x".repeat(65)]) assert.throws(() => parseDatacardId(bad), ConfigInputError);
  assert.equal(normalizeDatacardId("exertherm-07"), "exertherm-07");
  for (const v of [undefined, null, "", "bad id", 7]) assert.equal(normalizeDatacardId(v), null);
});

test("parseEmail trims, lower-cases, and rejects malformed addresses", () => {
  assert.equal(parseEmail("  Pat.Lee@Example.COM "), "pat.lee@example.com");
  for (const bad of ["", "pat", "pat@", "@example.com", "pat@example", "pat lee@example.com", `${"a".repeat(250)}@x.com`, null]) {
    assert.throws(() => parseEmail(bad), ConfigInputError);
  }
});

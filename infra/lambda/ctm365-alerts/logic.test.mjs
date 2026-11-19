import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEmail,
  channelsFrom,
  customersForDatacard,
  evaluate,
  formatRise,
  rearmMargin,
  stateKey,
} from "./logic.mjs";

const customer = {
  customerId: "Acme Foods",
  siteName: "Plant 1",
  tempUnit: "F",
  thresholds: { watchC: 10, criticalC: 25 },
  services: { electrical: true, hvac: false },
  electricalDatacardId: "exertherm-07",
  electricalSampleData: false,
  assets: [{ id: "a1", name: "MSWB" }],
  sensors: [
    { id: "s1", name: "Phase A lug", assetId: "a1", channel: 1 },
    { id: "s2", name: "Phase B lug", assetId: "a1", channel: 2 },
    { id: "orphan", name: "No asset", assetId: "gone", channel: 3 },
  ],
};

/** Feeds readings (Celsius per channel) through evaluate, carrying state, and returns alert counts per step. */
function run(series) {
  let state = {};
  return series.map((channels, i) => {
    const { states, alerts } = evaluate(customer, channels, 1000 + i, state);
    state = Object.fromEntries(states.map((s) => [s.key, { status: s.status, streak: s.streak }]));
    return alerts.map((a) => a.sensor.id);
  });
}

test("channelsFrom converts SensorN raw x 0.1 and skips non-numbers", () => {
  assert.deepEqual(channelsFrom({ Sensor1: 251, Sensor2: "100", Sensor3: "x" }), { 1: 25.1, 2: 10 });
  assert.deepEqual(channelsFrom(undefined), {});
});

test("one critical reading is not enough; two in a row alert once", () => {
  assert.deepEqual(run([{ 1: 26 }, { 1: 5 }, { 1: 26 }, { 1: 27 }, { 1: 28 }, { 1: 29 }]), [[], [], [], ["s1"], [], []]);
});

test("re-arms only after dropping below Critical minus the margin", () => {
  const margin = rearmMargin(customer.thresholds); // 1.5 C
  assert.equal(margin, 1.5);
  const steps = run([{ 1: 26 }, { 1: 26 }, { 1: 24 }, { 1: 26 }, { 1: 26 }, { 1: 23 }, { 1: 26 }, { 1: 26 }]);
  // 24 is within the margin (still alerted), so no new alert at 26; 23 re-arms, then two criticals alert again.
  assert.deepEqual(steps, [[], ["s1"], [], [], [], [], [], ["s1"]]);
});

test("each sensor is independent, and sensors without an asset never alert", () => {
  assert.deepEqual(run([{ 1: 30, 2: 30, 3: 30 }, { 1: 30, 2: 30, 3: 30 }]), [[], ["s1", "s2"]]);
});

test("a missing channel leaves that sensor's state alone", () => {
  const first = evaluate(customer, { 1: 30 }, 1, {});
  assert.equal(first.states.length, 1);
  assert.equal(first.states[0].key, stateKey("Acme Foods", "s1"));
});

test("only live electrical customers on this datacard are checked", () => {
  const others = [
    customer,
    { ...customer, customerId: "demo", electricalSampleData: true },
    { ...customer, customerId: "off", services: { electrical: false, hvac: true } },
    { ...customer, customerId: "other-card", electricalDatacardId: "exertherm-09" },
    { ...customer, customerId: "legacy", services: undefined },
  ];
  assert.deepEqual(
    customersForDatacard(others, "exertherm-07").map((c) => c.customerId),
    ["Acme Foods", "legacy"],
  );
});

test("email shows the reading in the customer's unit and escapes names", () => {
  assert.equal(formatRise(25, "F"), "45.0°F");
  assert.equal(formatRise(25, "C"), "25.0°C");
  const evil = { ...customer, siteName: "<b>Plant</b>" };
  const email = buildEmail(
    { customer: evil, asset: customer.assets[0], sensor: customer.sensors[0], value: 26.04, ts: Date.UTC(2026, 10, 19, 20, 5), thresholds: customer.thresholds },
    { dashboardUrl: "https://dashboard.ctm365.com", timeZone: "America/Los_Angeles" },
  );
  assert.equal(email.subject, "CRITICAL: <b>Plant</b> - MSWB / Phase A lug at 46.9 F rise");
  assert.match(email.text, /above the Critical limit of 45\.0°F/);
  assert.match(email.text, /admin\/Acme%20Foods/);
  assert.ok(!email.html.includes("<b>Plant</b>"), "HTML is escaped");
  assert.match(email.html, /&lt;b&gt;Plant&lt;\/b&gt;/);
});

test("HTML email declares UTF-8 and writes the degree sign as an entity", () => {
  const email = buildEmail(
    { customer, asset: customer.assets[0], sensor: customer.sensors[0], value: 26, ts: Date.UTC(2026, 10, 19), thresholds: customer.thresholds },
    { dashboardUrl: "https://dashboard.ctm365.com", timeZone: "America/Los_Angeles" },
  );
  assert.match(email.html, /<meta charset="utf-8">/);
  assert.ok(!/[^\x00-\x7f]/.test(email.html), "HTML is plain ASCII");
  assert.match(email.html, /46\.8&#176;F/);
  assert.match(email.text, /46\.8°F/, "plain-text part keeps the real character");
});

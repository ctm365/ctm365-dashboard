import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, dayStart } from "./index.mjs";

const LA = "America/Los_Angeles";

test("local midnight in Los Angeles, including both daylight-saving change days", () => {
  assert.equal(new Date(dayStart("2026-11-19", LA)).toISOString(), "2026-11-19T08:00:00.000Z"); // PST
  assert.equal(new Date(dayStart("2026-07-04", LA)).toISOString(), "2026-07-04T07:00:00.000Z"); // PDT
  assert.equal(new Date(dayStart("2026-03-08", LA)).toISOString(), "2026-03-08T08:00:00.000Z"); // spring forward day starts in PST
  assert.equal(new Date(dayStart("2026-11-01", LA)).toISOString(), "2026-11-01T07:00:00.000Z"); // fall back day starts in PDT
});

test("dayKey uses the site's date, not UTC", () => {
  assert.equal(dayKey(Date.parse("2026-11-19T07:59:00Z"), LA), "2026-11-18");
  assert.equal(dayKey(Date.parse("2026-11-19T08:00:00Z"), LA), "2026-11-19");
});

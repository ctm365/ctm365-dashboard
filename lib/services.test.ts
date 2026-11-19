import assert from "node:assert/strict";
import { test } from "node:test";
import { enabledServices, SERVICES } from "./services.ts";

test("enabledServices keeps tab order and drops services that are off", () => {
  assert.deepEqual(enabledServices({ electrical: true, hvac: true }).map((s) => s.id), ["electrical", "hvac"]);
  assert.deepEqual(enabledServices({ electrical: false, hvac: true }).map((s) => s.id), ["hvac"]);
  assert.deepEqual(enabledServices({ electrical: true, hvac: false }).map((s) => s.id), ["electrical"]);
  assert.deepEqual(enabledServices({ electrical: false, hvac: false }), []);
});

test("every service has its own page path", () => {
  const paths = SERVICES.map((s) => s.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const p of paths) assert.match(p, /^\/[a-z]+$/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSecretHash } from "./secret-hash.ts";

// RFC 4231 test case 2: HMAC-SHA256(key "Jefe", "what do ya want for nothing?").
const RFC4231_CASE_2_HEX = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

test("matches the RFC 4231 HMAC-SHA256 vector, base64-encoded", () => {
  // The message is username + clientId, so split the RFC message across both.
  const hash = computeSecretHash("what do ya want ", "for nothing?", "Jefe");
  assert.equal(hash, Buffer.from(RFC4231_CASE_2_HEX, "hex").toString("base64"));
  assert.equal(hash, "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=");
});

test("hashes username before clientId", () => {
  assert.notEqual(computeSecretHash("a", "b", "secret"), computeSecretHash("b", "a", "secret"));
});

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/crypto";

/**
 * Crypto tests need AUTH_SECRET to derive the envelope key. Set it
 * here for the test run rather than requiring the operator to set it
 * for `npm test`. Use a fixed string so the test is deterministic.
 *
 * A static import is safe even though it's hoisted above this hook:
 * crypto.ts derives (and caches) the key lazily on the first
 * encrypt/decrypt *call*, not at import time. `before` runs ahead of
 * any test body, so AUTH_SECRET is in place by the first call.
 */
before(() => {
  process.env.AUTH_SECRET = "test-secret-for-crypto-tests-32+ chars long";
});

test("encryptSecret produces a different string for the same input each call", () => {
  const a = encryptSecret("hello");
  const b = encryptSecret("hello");
  assert.notEqual(a, b, "different IV ⇒ different ciphertext");
});

test("round-trip preserves the plaintext", () => {
  const original = "EAAGabc123XYZ.this-is-a-meta-style-token";
  const enc = encryptSecret(original);
  assert.equal(decryptSecret(enc), original);
});

test("envelope has the enc:v1: prefix", () => {
  const enc = encryptSecret("x");
  assert.ok(enc.startsWith("enc:v1:"));
  assert.equal(isEncrypted(enc), true);
});

test("plaintext input round-trips through decryptSecret unchanged", () => {
  // Legacy compatibility — pre-migration rows store the raw value.
  assert.equal(decryptSecret("legacy-plain-token"), "legacy-plain-token");
});

test("decryptSecret returns null on tampered ciphertext", () => {
  const enc = encryptSecret("secret");
  // Flip a character in the ciphertext segment.
  const tampered = enc.slice(0, -2) + (enc.slice(-2) === "AA" ? "BB" : "AA");
  assert.equal(decryptSecret(tampered), null);
});

test("decryptSecret returns null on malformed envelope", () => {
  assert.equal(decryptSecret("enc:v1:not-real-base64"), null);
  assert.equal(decryptSecret("enc:v1:onlyonepart"), null);
});

test("decryptSecret returns null for null/undefined/empty", () => {
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(undefined), null);
  assert.equal(decryptSecret(""), null);
});

test("isEncrypted distinguishes envelope from plaintext", () => {
  assert.equal(isEncrypted(encryptSecret("a")), true);
  assert.equal(isEncrypted("legacy"), false);
  assert.equal(isEncrypted(null), false);
});

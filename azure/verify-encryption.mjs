// Self-test of lib/encryption.ts and lib/keys.ts with throwaway random keys.
// Touches no database.   node azure/verify-encryption.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  blindIndex,
  decryptField,
  decryptJson,
  encryptField,
  encryptJson,
  isEncrypted,
  keyFingerprint,
  normalizeEmail,
  parseKeySetting,
  setKeyring,
} from "../lib/encryption.ts";
import { loadKeyring, registerKeyFingerprints, verifyKeyFingerprints } from "../lib/keys.ts";

const newKey = () => crypto.randomBytes(32).toString("base64");
const k1 = newKey();
const k2 = newKey();
const ring1 = parseKeySetting(`k1:${k1}`);
const ring2 = parseKeySetting(`k2:${k2}, k1:${k1}`);

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok   ${name}`);
    })
    .catch((error) => {
      console.error(`  FAIL ${name}\n       ${error.message}`);
      process.exitCode = 1;
    });
}

/** Swaps one character of a base64 part so the value is damaged but still well-formed. */
function damage(value, partIndex) {
  const parts = value.split(":");
  const part = parts[partIndex];
  const i = Math.min(2, part.length - 3);
  parts[partIndex] = part.slice(0, i) + (part[i] === "A" ? "B" : "A") + part.slice(i + 1);
  return parts.join(":");
}

console.log("Encryption self-test");

await test("no keys loaded -> clear error", () => {
  setKeyring(null);
  assert.throws(() => encryptField("x"), /not loaded/);
});

setKeyring(ring1);

await test("round trip (ASCII, Hindi, emoji, long text)", () => {
  for (const text of ["Rahul Sharma", "राहुल शर्मा", "👋 hello", "x".repeat(20000)]) {
    const encrypted = encryptField(text);
    assert.ok(isEncrypted(encrypted));
    assert.ok(encrypted.startsWith("enc:v1:k1:"));
    assert.equal(decryptField(encrypted), text);
  }
});

await test("random IV: same text encrypts differently each time", () => {
  assert.notEqual(encryptField("same"), encryptField("same"));
});

await test("null / undefined / empty pass through", () => {
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(undefined), null);
  assert.equal(encryptField(""), "");
  assert.equal(decryptField(null), null);
  assert.equal(decryptField(""), "");
});

await test("plain text (not migrated yet) is read as it is", () => {
  assert.equal(decryptField("9876543210"), "9876543210");
  assert.equal(decryptField("enc:v1:looks-like-but-is-not"), "enc:v1:looks-like-but-is-not");
});

await test("already-encrypted value is not encrypted twice", () => {
  const once = encryptField("a");
  assert.equal(encryptField(once), once);
});

await test("tampered ciphertext, tag or IV -> throws", () => {
  const value = encryptField("secret note");
  for (const part of [3, 4, 5]) {
    assert.throws(() => decryptField(damage(value, part)), /could not be decrypted/);
  }
});

await test("unknown key id -> throws with the key name", () => {
  const value = encryptField("x").replace("enc:v1:k1:", "enc:v1:k9:");
  assert.throws(() => decryptField(value), /needs key "k9"/);
});

await test("rotation: old values still read, new values use the new key", () => {
  const old = encryptField("before rotation");
  setKeyring(ring2);
  assert.equal(decryptField(old), "before rotation");
  assert.ok(encryptField("after").startsWith("enc:v1:k2:"));
  setKeyring(ring1);
});

await test("JSON round trip, and legacy jsonb / text[] pass through", () => {
  const analysis = { summary: "ok", holdings: [{ name: "HDFC", weight: 0.2 }] };
  assert.deepEqual(decryptJson(encryptJson(analysis)), analysis);
  assert.deepEqual(decryptJson(encryptJson(["Investor", "HNI"])), ["Investor", "HNI"]);
  assert.deepEqual(decryptJson(analysis), analysis);
  assert.deepEqual(decryptJson(["Investor"]), ["Investor"]);
  assert.deepEqual(decryptJson('{"a":1}'), { a: 1 });
  assert.equal(encryptJson(null), null);
});

await test("blind index: deterministic, keyed, kinds kept apart", () => {
  const a = blindIndex("phone", "9876543210");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(blindIndex("phone", "9876543210"), a);
  assert.notEqual(blindIndex("email", "9876543210"), a);
  assert.notEqual(blindIndex("phone", "9876543211"), a);
  assert.equal(blindIndex("phone", ""), null);
  assert.equal(blindIndex("email", normalizeEmail("  A@B.com ")), blindIndex("email", "a@b.com"));
  const otherRing = parseKeySetting(`k1:${newKey()}`);
  setKeyring(otherRing);
  assert.notEqual(blindIndex("phone", "9876543210"), a);
  setKeyring(ring1);
});

await test("key setting: format, rotation order, derived keys", () => {
  assert.throws(() => parseKeySetting(""), /empty/);
  assert.throws(() => parseKeySetting("no-colon-here"), /v1:<secret>/);
  assert.throws(() => parseKeySetting("v1:"), /v1:<secret>/);
  assert.throws(() => parseKeySetting(`v1:${k1},v1:${k2}`), /listed twice/);
  assert.equal(ring2.currentKeyId, "k2", "first listed key encrypts");
  assert.ok(ring1.indexKey.equals(ring2.indexKey), "rotation keeps the lookup-hash key (made from the oldest key)");
  assert.ok(!ring1.fieldKeys.get("k1").equals(ring1.indexKey), "field and index keys differ");
  assert.equal(ring1.fieldKeys.get("k1").length, 32);
  assert.deepEqual(parseKeySetting("v1:short-placeholder").weakKeyIds, ["v1"]);
  assert.deepEqual(ring1.weakKeyIds, []);
  assert.ok(parseKeySetting("v1:same-secret-for-both-calls-123456").fieldKeys.get("v1")
    .equals(parseKeySetting("v1:same-secret-for-both-calls-123456").fieldKeys.get("v1")), "same secret, same key");
});

await test("short keys: warned in development, refused in production", async () => {
  const weak = { PII_ENCRYPTION_SECRET_KEY: "v1:short-placeholder" };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.ok(await loadKeyring({ ...weak, NODE_ENV: "development" }));
  } finally {
    console.warn = warn;
  }
  await assert.rejects(loadKeyring({ ...weak, NODE_ENV: "production" }), /shorter than 32/);
  assert.ok(await loadKeyring({ PII_ENCRYPTION_SECRET_KEY: `v1:${k1}`, NODE_ENV: "production" }));
  assert.equal(await loadKeyring({}), null);
});

/** In-memory stand-in for the encryption_keys table. */
function fakeTable() {
  const rows = new Map();
  const query = async (sql, params = []) => {
    if (sql.startsWith("select")) return { rows: [...rows].map(([key_id, fingerprint]) => ({ key_id, fingerprint })) };
    if (sql.startsWith("insert")) {
      if (!rows.has(params[0])) rows.set(params[0], params[1]);
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { rows, query };
}

await test("fingerprints: unregistered keys refused, registered keys accepted", async () => {
  const table = fakeTable();
  await assert.rejects(verifyKeyFingerprints(ring1, table.query), /not registered/);
  assert.deepEqual((await registerKeyFingerprints(ring1, table.query)).sort(), ["index", "k1"]);
  await verifyKeyFingerprints(ring1, table.query);
  assert.equal(table.rows.get("k1"), keyFingerprint(ring1.fieldKeys.get("k1")));
});

await test("fingerprints: a different key under the same id is refused", async () => {
  const table = fakeTable();
  await registerKeyFingerprints(ring1, table.query);
  const impostor = parseKeySetting(`k1:${newKey()}`);
  await assert.rejects(verifyKeyFingerprints(impostor, table.query), /not the key this database uses/);
  await assert.rejects(registerKeyFingerprints(impostor, table.query), /different key/);
});

await test("fingerprints: rotation registers k2; dropping k1 is refused", async () => {
  const table = fakeTable();
  await registerKeyFingerprints(ring1, table.query);
  assert.deepEqual(await registerKeyFingerprints(ring2, table.query), ["k2"]);
  const onlyK2 = parseKeySetting(`k2:${k2}`);
  await assert.rejects(verifyKeyFingerprints(onlyK2, table.query), /not the key this database uses|which is not loaded/);
});

console.log(process.exitCode ? "\nSome checks FAILED." : `\nAll ${passed} checks passed.`);

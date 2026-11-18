// Self-test of lib/encryption.ts and lib/keys.ts with throwaway random keys.
// Touches no database and no Key Vault.   node azure/verify-encryption.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  blindIndex,
  decryptField,
  decryptJson,
  decryptRows,
  encryptField,
  encryptJson,
  isEncrypted,
  keyFingerprint,
  normalizeEmail,
  parseKeyring,
  setKeyring,
} from "../lib/encryption.ts";
import { loadKeyring, registerKeyFingerprints, verifyKeyFingerprints } from "../lib/keys.ts";

const newKey = () => crypto.randomBytes(32).toString("base64");
const k1 = newKey();
const k2 = newKey();
const indexKey = newKey();
const ring1 = parseKeyring(JSON.stringify({ current: "k1", keys: { k1 } }), indexKey);
const ring2 = parseKeyring(JSON.stringify({ current: "k2", keys: { k1, k2 } }), indexKey);

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
  assert.throws(() => encryptField("x", "contacts.name"), /not loaded/);
});

setKeyring(ring1);

await test("round trip (ASCII, Hindi, emoji, long text)", () => {
  for (const text of ["Rahul Sharma", "राहुल शर्मा", "👋 hello", "x".repeat(20000)]) {
    const encrypted = encryptField(text, "contacts.name");
    assert.ok(isEncrypted(encrypted));
    assert.ok(encrypted.startsWith("enc:v1:k1:"));
    assert.equal(decryptField(encrypted, "contacts.name"), text);
  }
});

await test("random IV: same text encrypts differently each time", () => {
  assert.notEqual(encryptField("same", "contacts.name"), encryptField("same", "contacts.name"));
});

await test("null / undefined / empty pass through", () => {
  assert.equal(encryptField(null, "contacts.name"), null);
  assert.equal(encryptField(undefined, "contacts.name"), null);
  assert.equal(encryptField("", "contacts.name"), "");
  assert.equal(decryptField(null, "contacts.name"), null);
  assert.equal(decryptField("", "contacts.name"), "");
});

await test("plain text (not migrated yet) is read as it is", () => {
  assert.equal(decryptField("9876543210", "contacts.phone"), "9876543210");
  assert.equal(decryptField("enc:v1:looks-like-but-is-not", "contacts.phone"), "enc:v1:looks-like-but-is-not");
});

await test("already-encrypted value is not encrypted twice", () => {
  const once = encryptField("a", "contacts.name");
  assert.equal(encryptField(once, "contacts.name"), once);
});

await test("tampered ciphertext, tag or IV -> throws", () => {
  const value = encryptField("secret note", "contacts.notes");
  for (const part of [3, 4, 5]) {
    assert.throws(() => decryptField(damage(value, part), "contacts.notes"), /could not be decrypted/);
  }
});

await test("value moved to another column -> throws", () => {
  const value = encryptField("9876543210", "contacts.phone");
  assert.throws(() => decryptField(value, "broadcast_recipients.phone"), /could not be decrypted/);
});

await test("unknown key id -> throws with the key name", () => {
  const value = encryptField("x", "contacts.name").replace("enc:v1:k1:", "enc:v1:k9:");
  assert.throws(() => decryptField(value, "contacts.name"), /needs key "k9"/);
});

await test("rotation: old values still read, new values use the new key", () => {
  const old = encryptField("before rotation", "contacts.name");
  setKeyring(ring2);
  assert.equal(decryptField(old, "contacts.name"), "before rotation");
  assert.ok(encryptField("after", "contacts.name").startsWith("enc:v1:k2:"));
  setKeyring(ring1);
});

await test("JSON round trip, and legacy jsonb / text[] pass through", () => {
  const analysis = { summary: "ok", holdings: [{ name: "HDFC", weight: 0.2 }] };
  assert.deepEqual(decryptJson(encryptJson(analysis, "portfolio_updates.analysis"), "portfolio_updates.analysis"), analysis);
  assert.deepEqual(decryptJson(encryptJson(["Investor", "HNI"], "contacts.tags"), "contacts.tags"), ["Investor", "HNI"]);
  assert.deepEqual(decryptJson(analysis, "portfolio_updates.analysis"), analysis);
  assert.deepEqual(decryptJson(["Investor"], "contacts.tags"), ["Investor"]);
  assert.deepEqual(decryptJson('{"a":1}', "portfolio_updates.analysis"), { a: 1 });
  assert.equal(encryptJson(null, "contacts.tags"), null);
});

await test("blind index: deterministic, keyed, kinds kept apart", () => {
  const a = blindIndex("phone", "9876543210");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(blindIndex("phone", "9876543210"), a);
  assert.notEqual(blindIndex("email", "9876543210"), a);
  assert.notEqual(blindIndex("phone", "9876543211"), a);
  assert.equal(blindIndex("phone", ""), null);
  assert.equal(blindIndex("email", normalizeEmail("  A@B.com ")), blindIndex("email", "a@b.com"));
  const otherRing = parseKeyring(JSON.stringify({ current: "k1", keys: { k1 } }), newKey());
  setKeyring(otherRing);
  assert.notEqual(blindIndex("phone", "9876543210"), a);
  setKeyring(ring1);
});

await test("decryptRows decrypts only the listed columns", () => {
  const rows = [{ id: "1", name: encryptField("Asha", "contacts.name"), phone: "plain" }];
  assert.deepEqual(decryptRows(rows, "contacts", ["name"]), [{ id: "1", name: "Asha", phone: "plain" }]);
});

await test("key parsing rejects bad input", () => {
  assert.throws(() => parseKeyring("not json", indexKey), /not valid JSON/);
  assert.throws(() => parseKeyring(JSON.stringify({ current: "k1", keys: { k1: "c2hvcnQ=" } }), indexKey), /32 bytes/);
  assert.throws(() => parseKeyring(JSON.stringify({ current: "k2", keys: { k1 } }), indexKey), /not in the keys list/);
  assert.throws(() => parseKeyring(JSON.stringify({ current: "a:b", keys: { "a:b": k1 } }), indexKey), /letters, digits/);
  assert.throws(() => parseKeyring(JSON.stringify({ current: "k1", keys: { k1 } }), k1), /must differ/);
});

await test("development keys are refused in production", async () => {
  const env = { CRM_FIELD_KEYS: JSON.stringify({ current: "k1", keys: { k1 } }), CRM_INDEX_KEY: indexKey };
  assert.ok(await loadKeyring({ ...env, NODE_ENV: "development" }));
  await assert.rejects(loadKeyring({ ...env, NODE_ENV: "production" }), /development only/);
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
  assert.equal(table.rows.get("k1"), keyFingerprint(Buffer.from(k1, "base64")));
});

await test("fingerprints: a different key under the same id is refused", async () => {
  const table = fakeTable();
  await registerKeyFingerprints(ring1, table.query);
  const impostor = parseKeyring(JSON.stringify({ current: "k1", keys: { k1: newKey() } }), indexKey);
  await assert.rejects(verifyKeyFingerprints(impostor, table.query), /not the key this database uses/);
  await assert.rejects(registerKeyFingerprints(impostor, table.query), /different key/);
});

await test("fingerprints: rotation registers k2; dropping k1 is refused", async () => {
  const table = fakeTable();
  await registerKeyFingerprints(ring1, table.query);
  assert.deepEqual(await registerKeyFingerprints(ring2, table.query), ["k2"]);
  const onlyK2 = parseKeyring(JSON.stringify({ current: "k2", keys: { k2 } }), indexKey);
  await assert.rejects(verifyKeyFingerprints(onlyK2, table.query), /uses encryption key "k1", which is not loaded/);
});

console.log(process.exitCode ? "\nSome checks FAILED." : `\nAll ${passed} checks passed.`);

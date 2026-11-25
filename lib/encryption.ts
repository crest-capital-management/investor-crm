/**
 * Field-level encryption for personal data stored in the database.
 *
 * - AES-256-GCM with a random 12-byte IV per value. The stored text is
 *     enc:v1:<keyId>:<iv base64>:<tag base64>:<ciphertext base64>
 *   so old keys keep working after a rotation (keyId says which key to use).
 * - Values are self-describing, so lib/db.ts decrypts every text value it
 *   reads automatically: queries, joins and SQL functions need no changes to
 *   read encrypted columns. Only writes call encryptField. For the same reason
 *   a value is not bound to its column (a trigger or function may copy it).
 * - Values that are not in that format are returned as they are when read
 *   (rows not migrated yet, old backups), so code can switch to these
 *   helpers before the data is encrypted.
 * - Exact lookups (phone, email) use a keyed hash, the "blind index", made
 *   with a separate key: same input -> same hash, but it can't be reversed.
 *
 * Imports only node:crypto (no "@/..." paths) so the scripts in azure/ can
 * import this file directly with Node.
 */
import crypto from "node:crypto";

export interface Keyring {
  /** Id of the key new values are encrypted with. */
  currentKeyId: string;
  /** Every field key still needed to read data (current and older ones). */
  fieldKeys: Map<string, Buffer>;
  /** Key for blind-index hashes. Changing it means re-hashing every row. */
  indexKey: Buffer;
  /** Keys made from secrets shorter than MIN_SECRET_LENGTH (refused in production). */
  weakKeyIds: string[];
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
// iv = 12 bytes -> 16 base64 chars; tag = 16 bytes -> 22 chars + "==".
const CIPHERTEXT_PATTERN =
  /^enc:v1:([A-Za-z0-9_-]{1,32}):([A-Za-z0-9+/]{16}):([A-Za-z0-9+/]{22}==):([A-Za-z0-9+/]*={0,2})$/;

// Kept on globalThis: Next.js may load this module more than once (the
// instrumentation bundle and the app bundles), and they must share one keyring.
const KEYRING_SLOT = Symbol.for("crest-crm.encryption.keyring");
type KeyringHolder = { [KEYRING_SLOT]?: Keyring };

export function setKeyring(keyring: Keyring | null): void {
  (globalThis as KeyringHolder)[KEYRING_SLOT] = keyring ?? undefined;
}

export function hasKeyring(): boolean {
  return Boolean((globalThis as KeyringHolder)[KEYRING_SLOT]);
}

function keyring(): Keyring {
  const loaded = (globalThis as KeyringHolder)[KEYRING_SLOT];
  if (!loaded) throw new Error("Encryption keys are not loaded.");
  return loaded;
}

// ---------------------------------------------------------------- key parsing

/** Secrets shorter than this are accepted only outside production (lib/keys.ts). */
export const MIN_SECRET_LENGTH = 32;

/** Turns a secret into a 256-bit key for one purpose (HKDF-SHA256), so one secret can serve several. */
function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), `crest-crm ${purpose}`, KEY_BYTES));
}

/**
 * Builds the keyring from the PII_ENCRYPTION_SECRET_KEY setting:
 *   "v1:<secret>"                 one key
 *   "v2:<new secret>,v1:<old>"    after a rotation: the FIRST key encrypts new
 *                                 values, every listed key can still read
 * The LAST (oldest) key also makes the lookup-hash key, so it must stay in the
 * list for as long as phone_hash/email_hash values made with it exist.
 */
export function parseKeySetting(setting: string): Keyring {
  const entries = setting
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error("The encryption key setting is empty.");

  const fieldKeys = new Map<string, Buffer>();
  const weakKeyIds: string[] = [];
  const secrets: string[] = [];
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const id = colon > 0 ? entry.slice(0, colon) : "";
    const secret = colon > 0 ? entry.slice(colon + 1).trim() : "";
    if (!KEY_ID_PATTERN.test(id) || !secret) {
      throw new Error('Each encryption key must look like "v1:<secret>" (several separated by commas, newest first).');
    }
    if (fieldKeys.has(id)) throw new Error(`Encryption key "${id}" is listed twice.`);
    fieldKeys.set(id, deriveKey(secret, "field key"));
    if (secret.length < MIN_SECRET_LENGTH) weakKeyIds.push(id);
    secrets.push(secret);
  }

  return {
    currentKeyId: [...fieldKeys.keys()][0],
    fieldKeys,
    indexKey: deriveKey(secrets[secrets.length - 1], "index key"),
    weakKeyIds,
  };
}

/** Short value that identifies a key without revealing it (stored in encryption_keys). */
export function keyFingerprint(key: Buffer): string {
  return crypto.createHmac("sha256", key).update("crest-crm key fingerprint v1").digest("hex").slice(0, 32);
}

// ------------------------------------------------------------ text encryption

// Fixed associated data: ties every value to this format and app.
const AAD = Buffer.from("crest-crm|v1", "utf8");

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && CIPHERTEXT_PATTERN.test(value);
}

/** Encrypts a text value. null/undefined -> null, "" stays "", already-encrypted values are returned unchanged. */
export function encryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value === "" || isEncrypted(value)) return value;

  const { currentKeyId, fieldKeys } = keyring();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", fieldKeys.get(currentKeyId)!, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${currentKeyId}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a value written by encryptField. Plain text (not yet migrated) is
 * returned unchanged. Throws if the value was tampered with or needs a key
 * that is not loaded.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = typeof value === "string" ? CIPHERTEXT_PATTERN.exec(value) : null;
  if (!match) return value;

  const [, keyId, ivB64, tagB64, ctB64] = match;
  const key = keyring().fieldKeys.get(keyId);
  if (!key) throw new Error(`An encrypted value needs key "${keyId}", which is not loaded.`);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("An encrypted value could not be decrypted (wrong key or damaged).");
  }
}

// ------------------------------------------------------------ JSON encryption

/** Encrypts any JSON value (arrays, objects) as text. null/undefined -> null. */
export function encryptJson(value: unknown): string | null {
  if (value == null) return null;
  return encryptField(JSON.stringify(value));
}

/**
 * Reads a value written by encryptJson. Values that are not encrypted are
 * passed through: objects/arrays as the database returned them (jsonb, text[]),
 * strings parsed as JSON when possible.
 */
export function decryptJson<T = unknown>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== "string") return value as T;
  const text = isEncrypted(value) ? decryptField(value)! : value;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (isEncrypted(value)) throw new Error("An encrypted value decrypted to invalid JSON.");
    return value as unknown as T;
  }
}

// ---------------------------------------------------------------- blind index

/**
 * Keyed hash of an already-normalised value, for exact-match lookups on
 * encrypted columns. `kind` keeps phone, email and tag hashes apart. Empty -> null.
 */
export function blindIndex(kind: "phone" | "email" | "tag", normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  return crypto.createHmac("sha256", keyring().indexKey).update(`${kind}\u0000${normalized}`, "utf8").digest("hex");
}

/** The form emails are compared in (matches the lower(email) index). */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

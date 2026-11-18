/**
 * Field-level encryption for personal data stored in the database.
 *
 * - AES-256-GCM with a random 12-byte IV per value. The stored text is
 *     enc:v1:<keyId>:<iv base64>:<tag base64>:<ciphertext base64>
 *   so old keys keep working after a rotation (keyId says which key to use).
 * - The table and column ("contacts.phone") are bound to each value as
 *   additional authenticated data, so a value copied into another column
 *   fails to decrypt instead of showing up in the wrong place.
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

/** "table.column", e.g. "contacts.phone". */
export type FieldName = `${string}.${string}`;

export interface Keyring {
  /** Id of the key new values are encrypted with. */
  currentKeyId: string;
  /** Every field key still needed to read data (current and older ones). */
  fieldKeys: Map<string, Buffer>;
  /** Key for blind-index hashes. Changing it means re-hashing every row. */
  indexKey: Buffer;
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

function decodeKey(base64: string, what: string): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new Error(`${what} must be ${KEY_BYTES} bytes, base64-encoded.`);
  return key;
}

/**
 * Builds a keyring from the two stored secrets:
 *   field keys: {"current":"k1","keys":{"k1":"<base64 32 bytes>", ...}}
 *   index key:  "<base64 32 bytes>"
 */
export function parseKeyring(fieldKeysJson: string, indexKeyBase64: string): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fieldKeysJson);
  } catch {
    throw new Error("The field keys secret is not valid JSON.");
  }
  const { current, keys } = (parsed ?? {}) as { current?: unknown; keys?: unknown };
  if (typeof current !== "string" || !keys || typeof keys !== "object") {
    throw new Error('The field keys secret must look like {"current":"k1","keys":{"k1":"..."}}.');
  }

  const fieldKeys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(keys as Record<string, unknown>)) {
    if (!KEY_ID_PATTERN.test(id)) throw new Error(`Key id "${id}" may only use letters, digits, _ and -.`);
    if (typeof value !== "string") throw new Error(`Field key ${id} must be a base64 string.`);
    fieldKeys.set(id, decodeKey(value, `Field key ${id}`));
  }
  if (!fieldKeys.has(current)) throw new Error(`The current field key "${current}" is not in the keys list.`);

  const indexKey = decodeKey(indexKeyBase64, "The index key");
  for (const [id, key] of fieldKeys) {
    if (key.equals(indexKey)) throw new Error(`The index key must differ from field key ${id}.`);
  }

  return { currentKeyId: current, fieldKeys, indexKey };
}

/** Short value that identifies a key without revealing it (stored in encryption_keys). */
export function keyFingerprint(key: Buffer): string {
  return crypto.createHmac("sha256", key).update("crest-crm key fingerprint v1").digest("hex").slice(0, 32);
}

// ------------------------------------------------------------ text encryption

function aad(field: FieldName): Buffer {
  return Buffer.from(`v1|${field}`, "utf8");
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && CIPHERTEXT_PATTERN.test(value);
}

/** Encrypts a text value. null/undefined -> null, "" stays "", already-encrypted values are returned unchanged. */
export function encryptField(value: string | null | undefined, field: FieldName): string | null {
  if (value == null) return null;
  if (value === "" || isEncrypted(value)) return value;

  const { currentKeyId, fieldKeys } = keyring();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", fieldKeys.get(currentKeyId)!, iv);
  cipher.setAAD(aad(field));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${currentKeyId}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a value written by encryptField. Plain text (not yet migrated) is
 * returned unchanged. Throws if the value was tampered with, belongs to
 * another column, or needs a key that is not loaded.
 */
export function decryptField(value: string | null | undefined, field: FieldName): string | null {
  if (value == null) return null;
  const match = typeof value === "string" ? CIPHERTEXT_PATTERN.exec(value) : null;
  if (!match) return value;

  const [, keyId, ivB64, tagB64, ctB64] = match;
  const key = keyring().fieldKeys.get(keyId);
  if (!key) throw new Error(`A value in ${field} needs key "${keyId}", which is not loaded.`);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAAD(aad(field));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(`A value in ${field} could not be decrypted (wrong key, wrong column or damaged).`);
  }
}

// ------------------------------------------------------------ JSON encryption

/** Encrypts any JSON value (arrays, objects) as text. null/undefined -> null. */
export function encryptJson(value: unknown, field: FieldName): string | null {
  if (value == null) return null;
  return encryptField(JSON.stringify(value), field);
}

/**
 * Reads a value written by encryptJson. Values that are not encrypted are
 * passed through: objects/arrays as the database returned them (jsonb, text[]),
 * strings parsed as JSON when possible.
 */
export function decryptJson<T = unknown>(value: unknown, field: FieldName): T | null {
  if (value == null) return null;
  if (typeof value !== "string") return value as T;
  const text = isEncrypted(value) ? decryptField(value, field)! : value;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (isEncrypted(value)) throw new Error(`A value in ${field} decrypted to invalid JSON.`);
    return value as unknown as T;
  }
}

// ---------------------------------------------------------------- blind index

/**
 * Keyed hash of an already-normalised value, for exact-match lookups on
 * encrypted columns. `kind` keeps phone and email hashes apart. Empty -> null.
 */
export function blindIndex(kind: "phone" | "email", normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  return crypto.createHmac("sha256", keyring().indexKey).update(`${kind}\u0000${normalized}`, "utf8").digest("hex");
}

/** The form emails are compared in (matches the lower(email) index). */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------- row helpers

/** Returns a copy of `row` with the listed text columns decrypted. */
export function decryptRow<T extends Record<string, unknown>>(row: T, table: string, columns: readonly (keyof T & string)[]): T {
  const copy: Record<string, unknown> = { ...row };
  for (const column of columns) {
    const value = copy[column];
    if (typeof value === "string") copy[column] = decryptField(value, `${table}.${column}`);
  }
  return copy as T;
}

export function decryptRows<T extends Record<string, unknown>>(rows: readonly T[], table: string, columns: readonly (keyof T & string)[]): T[] {
  return rows.map((row) => decryptRow(row, table, columns));
}

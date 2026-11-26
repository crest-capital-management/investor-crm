/**
 * Encryption of backup files at rest (TSK-38 package 5).
 *
 * A backup file is the gzipped JSON from lib/backup.ts, encrypted as a whole
 * with AES-256-GCM under BACKUP_ENCRYPTION_SECRET_KEY (a different key from the
 * personal-data key). File layout:
 *
 *   "CRESTBK1"   8 bytes  magic + format version
 *   n            1 byte   length of the key id
 *   key id       n bytes  e.g. "v1", says which key to decrypt with
 *   iv          12 bytes  random per file
 *   tag         16 bytes  GCM authentication tag
 *   ciphertext   rest     the gzipped JSON
 *
 * Everything before the tag is authenticated too (GCM associated data), so a
 * changed key id or header is detected like a changed byte of data.
 *
 * The setting works like PII_ENCRYPTION_SECRET_KEY: "v1:<secret>", or after a
 * rotation "v2:<new>,v1:<old>" (newest first; the first key encrypts new
 * files, every listed key can read). Old keys can be dropped once no backup
 * made with them is kept any more (30 days, see lib/backup.ts).
 *
 * Imports only node:crypto and relative files, so the scripts in azure/ can
 * import this file directly with Node.
 */
import crypto from "node:crypto";
import { MIN_SECRET_LENGTH } from "./encryption.ts";

export interface BackupKeyring {
  /** Id of the key new backup files are encrypted with. */
  currentKeyId: string;
  /** Every key still needed to read kept backups (current and older ones). */
  keys: Map<string, Buffer>;
  /** Keys made from secrets shorter than MIN_SECRET_LENGTH (refused in production). */
  weakKeyIds: string[];
}

const MAGIC = Buffer.from("CRESTBK1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Builds the backup keyring from the BACKUP_ENCRYPTION_SECRET_KEY setting.
 * The key is derived with its own purpose label, so even the same secret as
 * the personal-data key would give a different key.
 */
export function parseBackupKeySetting(setting: string): BackupKeyring {
  const entries = setting
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error("The backup encryption key setting is empty.");

  const keys = new Map<string, Buffer>();
  const weakKeyIds: string[] = [];
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const id = colon > 0 ? entry.slice(0, colon) : "";
    const secret = colon > 0 ? entry.slice(colon + 1).trim() : "";
    if (!KEY_ID_PATTERN.test(id) || !secret) {
      throw new Error('Each backup encryption key must look like "v1:<secret>" (several separated by commas, newest first).');
    }
    if (keys.has(id)) throw new Error(`Backup encryption key "${id}" is listed twice.`);
    keys.set(
      id,
      Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), "crest-crm backup file key", 32)),
    );
    if (secret.length < MIN_SECRET_LENGTH) weakKeyIds.push(id);
  }
  return { currentKeyId: [...keys.keys()][0], keys, weakKeyIds };
}

// Kept on globalThis, like the personal-data keyring (lib/encryption.ts): Next.js
// may load this module more than once and every copy must see the same keys.
const SLOT = Symbol.for("crest-crm.backup-encryption.keyring");
type Holder = { [SLOT]?: BackupKeyring };

export function setBackupKeyring(keyring: BackupKeyring | null): void {
  (globalThis as Holder)[SLOT] = keyring ?? undefined;
}

function loadedKeyring(): BackupKeyring {
  const keyring = (globalThis as Holder)[SLOT];
  if (!keyring) throw new Error("The backup encryption key is not loaded (BACKUP_ENCRYPTION_SECRET_KEY).");
  return keyring;
}

/** True if the bytes are an encrypted backup file (start with the magic). */
export function isEncryptedBackup(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC);
}

/** Encrypts a backup file's bytes with the current backup key. */
export function encryptBackup(plain: Buffer, keyring: BackupKeyring = loadedKeyring()): Buffer {
  const keyId = Buffer.from(keyring.currentKeyId, "ascii");
  const iv = crypto.randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, Buffer.from([keyId.length]), keyId, iv]);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyring.keys.get(keyring.currentKeyId)!, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
}

/** The key id an encrypted backup file was made with (from its header), or null if it isn't one. */
export function backupKeyId(bytes: Buffer): string | null {
  if (!isEncryptedBackup(bytes) || bytes.length < MAGIC.length + 1) return null;
  const length = bytes[MAGIC.length];
  const id = bytes.subarray(MAGIC.length + 1, MAGIC.length + 1 + length).toString("ascii");
  return KEY_ID_PATTERN.test(id) ? id : null;
}

/**
 * Decrypts an encrypted backup file. Throws a readable error if the file is
 * not one, needs a key that is not loaded, or was changed or damaged.
 */
export function decryptBackup(bytes: Buffer, keyring: BackupKeyring = loadedKeyring()): Buffer {
  const keyId = backupKeyId(bytes);
  const headerLength = MAGIC.length + 1 + (keyId?.length ?? 0) + IV_BYTES;
  if (!keyId || bytes.length < headerLength + TAG_BYTES) {
    throw new Error("This is not an encrypted CRM backup, or the file is damaged.");
  }
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new Error(`This backup was encrypted with backup key "${keyId}", which is not loaded (BACKUP_ENCRYPTION_SECRET_KEY).`);
  }

  const header = bytes.subarray(0, headerLength);
  const iv = header.subarray(headerLength - IV_BYTES);
  const tag = bytes.subarray(headerLength, headerLength + TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes.subarray(headerLength + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error("The backup could not be decrypted: the key is wrong or the file was changed or damaged.");
  }
}

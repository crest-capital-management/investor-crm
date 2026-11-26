/**
 * Loads the encryption keys and checks they are the ones this database uses.
 *
 * The keys come from the PII_ENCRYPTION_SECRET_KEY setting (server .env, and
 * .env.local on a PC that works against the same database): "v1:<secret>", or
 * several "v2:<new>,v1:<old>" after a rotation (lib/encryption.ts
 * parseKeySetting). Not set -> no keys (null).
 *
 * Secrets shorter than MIN_SECRET_LENGTH are refused when NODE_ENV=production
 * and only warned about otherwise.
 *
 * The backup file key (BACKUP_ENCRYPTION_SECRET_KEY, lib/backup-encryption.ts)
 * is loaded and checked the same way. Its fingerprints live in their own table,
 * backup_encryption_keys (migration 005), not in encryption_keys: code from
 * before package 5 refuses to start when encryption_keys holds a key it hasn't
 * loaded, so registering the backup key there would stop older code.
 *
 * Relative imports only, so the scripts in azure/ can import this file too.
 */
import { keyFingerprint, MIN_SECRET_LENGTH, parseKeySetting, type Keyring } from "./encryption.ts";
import { parseBackupKeySetting, type BackupKeyring } from "./backup-encryption.ts";

export const KEY_SETTING = "PII_ENCRYPTION_SECRET_KEY";
export const BACKUP_KEY_SETTING = "BACKUP_ENCRYPTION_SECRET_KEY";
/** encryption_keys.key_id used for the blind-index key. */
export const INDEX_KEY_ID = "index";

/** Where each kind of key's fingerprints are recorded (fixed names, never user input). */
const PII_KEYS = { table: "public.encryption_keys", setting: KEY_SETTING, label: "Encryption key" };
const BACKUP_KEYS = { table: "public.backup_encryption_keys", setting: BACKUP_KEY_SETTING, label: "Backup encryption key" };
type KeyKind = typeof PII_KEYS;

type Env = Record<string, string | undefined>;

function warnOrRefuseWeak(weakKeyIds: string[], label: string, env: Env): void {
  if (!weakKeyIds.length) return;
  const message =
    `${label} ${weakKeyIds.join(", ")} is shorter than ${MIN_SECRET_LENGTH} characters. ` +
    'Generate a proper one: echo "v1:$(openssl rand -base64 32)"';
  if (env.NODE_ENV === "production") throw new Error(message);
  console.warn(`[encryption] WARNING: ${message}`);
}

export async function loadKeyring(env: Env = process.env): Promise<Keyring | null> {
  const setting = env[KEY_SETTING]?.trim();
  if (!setting) return null;
  const keyring = parseKeySetting(setting);
  warnOrRefuseWeak(keyring.weakKeyIds, PII_KEYS.label, env);
  return keyring;
}

/** Same as loadKeyring, for the backup file key (BACKUP_ENCRYPTION_SECRET_KEY). Not set -> null. */
export async function loadBackupKeyring(env: Env = process.env): Promise<BackupKeyring | null> {
  const setting = env[BACKUP_KEY_SETTING]?.trim();
  if (!setting) return null;
  const keyring = parseBackupKeySetting(setting);
  warnOrRefuseWeak(keyring.weakKeyIds, BACKUP_KEYS.label, env);
  return keyring;
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function loadedFingerprints(keyring: Keyring): Map<string, string> {
  const loaded = new Map<string, string>([[INDEX_KEY_ID, keyFingerprint(keyring.indexKey)]]);
  for (const [id, key] of keyring.fieldKeys) loaded.set(id, keyFingerprint(key));
  return loaded;
}

function loadedBackupFingerprints(keyring: BackupKeyring): Map<string, string> {
  return new Map([...keyring.keys].map(([id, key]) => [id, keyFingerprint(key)]));
}

async function recordedFingerprints(query: Query, kind: KeyKind): Promise<Map<string, string>> {
  const { rows } = await query(`select key_id, fingerprint from ${kind.table}`);
  return new Map(rows.map((row) => [String(row.key_id), String(row.fingerprint)]));
}

function checkFingerprints(loaded: Map<string, string>, recorded: Map<string, string>, kind: KeyKind): void {
  for (const [id, fingerprint] of loaded) {
    const known = recorded.get(id);
    if (!known) {
      throw new Error(`${kind.label} "${id}" is not registered in this database. Run: node azure/register-keys.mjs`);
    }
    if (known !== fingerprint) {
      throw new Error(`${kind.label} "${id}" is not the key this database uses. Check ${kind.setting}.`);
    }
  }
  for (const id of recorded.keys()) {
    if (!loaded.has(id)) {
      throw new Error(`This database uses ${kind.label.toLowerCase()} "${id}", which is not loaded (${kind.setting}).`);
    }
  }
}

async function registerFingerprints(loaded: Map<string, string>, query: Query, kind: KeyKind): Promise<string[]> {
  const recorded = await recordedFingerprints(query, kind);
  for (const [id, fingerprint] of loaded) {
    const known = recorded.get(id);
    if (known && known !== fingerprint) {
      throw new Error(`${kind.label} "${id}" is already registered with a different key. Use a new key id instead.`);
    }
  }
  const added: string[] = [];
  for (const [id, fingerprint] of loaded) {
    if (recorded.has(id)) continue;
    await query(`insert into ${kind.table} (key_id, fingerprint) values ($1, $2) on conflict (key_id) do nothing`, [
      id,
      fingerprint,
    ]);
    added.push(id);
  }
  return added;
}

/**
 * Checks the loaded keys against the fingerprints recorded in encryption_keys,
 * so a server or script holding the wrong keys stops before it writes data
 * nobody can read later. Throws when:
 *   - a loaded key does not match its recorded fingerprint,
 *   - a loaded key is not recorded yet (run azure/register-keys.mjs first),
 *   - the database records a key this keyring lacks (older data unreadable).
 * Never writes: keys are only recorded by azure/register-keys.mjs, on purpose,
 * so a development PC (whose .env.local may point at the live database) can
 * never claim key ids with its own keys.
 */
export async function verifyKeyFingerprints(keyring: Keyring, query: Query): Promise<void> {
  checkFingerprints(loadedFingerprints(keyring), await recordedFingerprints(query, PII_KEYS), PII_KEYS);
}

/**
 * Same check for the backup file keys (backup_encryption_keys). A backup key
 * no longer listed but still recorded is refused too: backups made with it
 * could not be read. To retire an old backup key, delete its row once no
 * backup made with it is kept (azure/ENCRYPTION_KEYS.md).
 */
export async function verifyBackupKeyFingerprints(keyring: BackupKeyring, query: Query): Promise<void> {
  checkFingerprints(loadedBackupFingerprints(keyring), await recordedFingerprints(query, BACKUP_KEYS), BACKUP_KEYS);
}

/**
 * Records the fingerprints of keys this database has not seen yet (first
 * setup, or a new key after a rotation). Refuses if any key already recorded
 * has a different fingerprint. Returns the ids it recorded.
 */
export async function registerKeyFingerprints(keyring: Keyring, query: Query): Promise<string[]> {
  const added = await registerFingerprints(loadedFingerprints(keyring), query, PII_KEYS);
  await verifyKeyFingerprints(keyring, query);
  return added;
}

/** Same as registerKeyFingerprints, for the backup file keys. */
export async function registerBackupKeyFingerprints(keyring: BackupKeyring, query: Query): Promise<string[]> {
  const added = await registerFingerprints(loadedBackupFingerprints(keyring), query, BACKUP_KEYS);
  await verifyBackupKeyFingerprints(keyring, query);
  return added;
}

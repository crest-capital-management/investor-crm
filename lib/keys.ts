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
 * Relative imports only, so the scripts in azure/ can import this file too.
 */
import { keyFingerprint, MIN_SECRET_LENGTH, parseKeySetting, type Keyring } from "./encryption.ts";

export const KEY_SETTING = "PII_ENCRYPTION_SECRET_KEY";
/** encryption_keys.key_id used for the blind-index key. */
export const INDEX_KEY_ID = "index";

type Env = Record<string, string | undefined>;

export async function loadKeyring(env: Env = process.env): Promise<Keyring | null> {
  const setting = env[KEY_SETTING]?.trim();
  if (!setting) return null;

  const keyring = parseKeySetting(setting);
  if (keyring.weakKeyIds.length) {
    const message =
      `Encryption key ${keyring.weakKeyIds.join(", ")} is shorter than ${MIN_SECRET_LENGTH} characters. ` +
      'Generate a proper one: echo "v1:$(openssl rand -base64 32)"';
    if (env.NODE_ENV === "production") throw new Error(message);
    console.warn(`[encryption] WARNING: ${message}`);
  }
  return keyring;
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function loadedFingerprints(keyring: Keyring): Map<string, string> {
  const loaded = new Map<string, string>([[INDEX_KEY_ID, keyFingerprint(keyring.indexKey)]]);
  for (const [id, key] of keyring.fieldKeys) loaded.set(id, keyFingerprint(key));
  return loaded;
}

async function recordedFingerprints(query: Query): Promise<Map<string, string>> {
  const { rows } = await query("select key_id, fingerprint from public.encryption_keys");
  return new Map(rows.map((row) => [String(row.key_id), String(row.fingerprint)]));
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
  const loaded = loadedFingerprints(keyring);
  const recorded = await recordedFingerprints(query);

  for (const [id, fingerprint] of loaded) {
    const known = recorded.get(id);
    if (!known) {
      throw new Error(`Encryption key "${id}" is not registered in this database. Run: node azure/register-keys.mjs`);
    }
    if (known !== fingerprint) {
      throw new Error(`Encryption key "${id}" is not the key this database uses. Check PII_ENCRYPTION_SECRET_KEY.`);
    }
  }
  for (const id of recorded.keys()) {
    if (!loaded.has(id)) throw new Error(`This database uses encryption key "${id}", which is not loaded.`);
  }
}

/**
 * Records the fingerprints of keys this database has not seen yet (first
 * setup, or a new key after a rotation). Refuses if any key already recorded
 * has a different fingerprint. Returns the ids it recorded.
 */
export async function registerKeyFingerprints(keyring: Keyring, query: Query): Promise<string[]> {
  const loaded = loadedFingerprints(keyring);
  const recorded = await recordedFingerprints(query);
  for (const [id, fingerprint] of loaded) {
    const known = recorded.get(id);
    if (known && known !== fingerprint) {
      throw new Error(`Key "${id}" is already registered with a different key. Use a new key id instead.`);
    }
  }

  const added: string[] = [];
  for (const [id, fingerprint] of loaded) {
    if (recorded.has(id)) continue;
    await query(
      "insert into public.encryption_keys (key_id, fingerprint) values ($1, $2) on conflict (key_id) do nothing",
      [id, fingerprint],
    );
    added.push(id);
  }
  await verifyKeyFingerprints(keyring, query);
  return added;
}

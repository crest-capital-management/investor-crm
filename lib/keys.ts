/**
 * Loads the encryption keys and checks they are the ones this database uses.
 *
 * Where the keys come from:
 *   KEY_VAULT_URL set          -> Azure Key Vault, secrets "crm-field-keys" and
 *                                 "crm-index-key", signed in with
 *                                 DefaultAzureCredential (managed identity on the
 *                                 server, `az login` on a PC).
 *   CRM_FIELD_KEYS + CRM_INDEX_KEY -> taken from the environment. Development only:
 *                                 refused when NODE_ENV=production.
 *   neither                    -> no keys (null).
 *
 * Relative imports only, so the scripts in azure/ can import this file too.
 */
import { keyFingerprint, parseKeyring, type Keyring } from "./encryption.ts";

export const FIELD_KEYS_SECRET = "crm-field-keys";
export const INDEX_KEY_SECRET = "crm-index-key";
/** encryption_keys.key_id used for the blind-index key. */
export const INDEX_KEY_ID = "index";

type Env = Record<string, string | undefined>;

export async function loadKeyring(env: Env = process.env): Promise<Keyring | null> {
  const vaultUrl = env.KEY_VAULT_URL?.trim();
  if (vaultUrl) {
    const [{ DefaultAzureCredential }, { SecretClient }] = await Promise.all([
      import("@azure/identity"),
      import("@azure/keyvault-secrets"),
    ]);
    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());
    const [fieldKeys, indexKey] = await Promise.all([
      client.getSecret(FIELD_KEYS_SECRET),
      client.getSecret(INDEX_KEY_SECRET),
    ]);
    if (!fieldKeys.value || !indexKey.value) throw new Error("A Key Vault encryption secret is empty.");
    return parseKeyring(fieldKeys.value, indexKey.value);
  }

  const fieldKeys = env.CRM_FIELD_KEYS?.trim();
  const indexKey = env.CRM_INDEX_KEY?.trim();
  if (fieldKeys || indexKey) {
    if (env.NODE_ENV === "production") {
      throw new Error("CRM_FIELD_KEYS / CRM_INDEX_KEY are for development only. Use KEY_VAULT_URL in production.");
    }
    if (!fieldKeys || !indexKey) throw new Error("Set both CRM_FIELD_KEYS and CRM_INDEX_KEY, or neither.");
    return parseKeyring(fieldKeys, indexKey);
  }

  return null;
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
      throw new Error(`Encryption key "${id}" is not the key this database uses. Check KEY_VAULT_URL and the key secrets.`);
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

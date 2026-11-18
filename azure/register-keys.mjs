// Records the fingerprints of the encryption keys in encryption_keys, so the
// app and scripts can check they hold the right keys before touching data.
// Run once after creating the Key Vault secrets, and again after adding a new
// key for a rotation:
//   node azure/register-keys.mjs              (keys from KEY_VAULT_URL; needs `az login`)
//   node azure/register-keys.mjs --dev-keys   (keys from CRM_FIELD_KEYS/CRM_INDEX_KEY,
//                                              only for a test copy of the database)
// Prints key ids and fingerprints only, never the keys.
import { keyFingerprint } from "../lib/encryption.ts";
import { INDEX_KEY_ID, loadKeyring, registerKeyFingerprints } from "../lib/keys.ts";
import { connect, confirmDatabase, flag, loadEnv, run } from "./lib/script-env.mjs";

run(async () => {
  loadEnv();
  const fromVault = Boolean(process.env.KEY_VAULT_URL?.trim());
  if (!fromVault && !flag("--dev-keys")) {
    throw new Error(
      "KEY_VAULT_URL is not set. Keys from .env.local are for a test database only; " +
        "add --dev-keys if this really is a test copy (never the live database).",
    );
  }

  const keyring = await loadKeyring(process.env);
  if (!keyring) throw new Error("No keys found (set KEY_VAULT_URL, or CRM_FIELD_KEYS and CRM_INDEX_KEY).");

  const { client, database, label } = await connect();
  try {
    console.log(`Keys from: ${fromVault ? process.env.KEY_VAULT_URL : "environment (development keys)"}`);
    console.log(`Database:  ${label}`);
    console.log(`Current field key: ${keyring.currentKeyId}`);
    for (const [id, key] of keyring.fieldKeys) console.log(`  field key ${id}: ${keyFingerprint(key)}`);
    console.log(`  ${INDEX_KEY_ID} key:     ${keyFingerprint(keyring.indexKey)}`);

    const recorded = (await client.query("select key_id, fingerprint from public.encryption_keys order by key_id")).rows;
    console.log(recorded.length ? "Already registered:" : "No keys registered yet.");
    for (const row of recorded) console.log(`  ${row.key_id}: ${row.fingerprint}`);

    await confirmDatabase(database, `\nRegister any new key ids above in ${label}?`);
    const added = await registerKeyFingerprints(keyring, (sql, params) => client.query(sql, params));
    console.log(added.length ? `Registered: ${added.join(", ")}.` : "Nothing new to register; all keys match.");
  } finally {
    await client.end();
  }
});

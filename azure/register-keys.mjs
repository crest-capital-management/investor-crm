// Records the fingerprints of the encryption keys in encryption_keys, so the
// app and scripts can check they hold the right keys before touching data.
// Run once after setting PII_ENCRYPTION_SECRET_KEY, and again after adding a
// new key for a rotation:
//   node azure/register-keys.mjs
//   node azure/register-keys.mjs --allow-weak-key   (a short placeholder key, on a
//                                                    TEST database only)
// Prints key ids and fingerprints only, never the keys.
//
// Registering ties each key id ("v1") to its key in this database for good:
// a different secret can never be used under that id afterwards. So never
// register a placeholder key on the live database.
import { keyFingerprint, MIN_SECRET_LENGTH } from "../lib/encryption.ts";
import { INDEX_KEY_ID, KEY_SETTING, loadKeyring, registerKeyFingerprints } from "../lib/keys.ts";
import { connect, confirmDatabase, flag, loadEnv, run } from "./lib/script-env.mjs";

run(async () => {
  loadEnv();
  const keyring = await loadKeyring(process.env);
  if (!keyring) throw new Error(`${KEY_SETTING} is not set (in .env.local).`);
  if (keyring.weakKeyIds.length && !flag("--allow-weak-key")) {
    throw new Error(
      `Key ${keyring.weakKeyIds.join(", ")} is shorter than ${MIN_SECRET_LENGTH} characters. ` +
        "Registering it would tie that key id to a weak key for good. Use a proper key, or add " +
        "--allow-weak-key if this is a TEST database.",
    );
  }

  const { client, database, label } = await connect();
  try {
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

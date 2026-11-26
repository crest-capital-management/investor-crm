// Records the fingerprints of the encryption keys, so the app and scripts can
// check they hold the right keys before touching data: the personal-data keys
// (PII_ENCRYPTION_SECRET_KEY) in encryption_keys, the backup file keys
// (BACKUP_ENCRYPTION_SECRET_KEY) in backup_encryption_keys (migration 005).
// Run once after setting a key, and again after adding a new key for a rotation:
//   node azure/register-keys.mjs
//   node azure/register-keys.mjs --allow-weak-key   (a short placeholder key, on a
//                                                    TEST database only)
// Prints key ids and fingerprints only, never the keys.
//
// Registering ties each key id ("v1") to its key in this database for good:
// a different secret can never be used under that id afterwards. So never
// register a placeholder key on the live database.
import { keyFingerprint, MIN_SECRET_LENGTH } from "../lib/encryption.ts";
import {
  BACKUP_KEY_SETTING,
  INDEX_KEY_ID,
  KEY_SETTING,
  loadBackupKeyring,
  loadKeyring,
  registerBackupKeyFingerprints,
  registerKeyFingerprints,
} from "../lib/keys.ts";
import { connect, confirmDatabase, flag, loadEnv, run } from "./lib/script-env.mjs";

run(async () => {
  loadEnv();
  const keyring = await loadKeyring(process.env);
  if (!keyring) throw new Error(`${KEY_SETTING} is not set (in .env.local).`);
  const backupKeyring = await loadBackupKeyring(process.env);
  if (!backupKeyring) throw new Error(`${BACKUP_KEY_SETTING} is not set (in .env.local).`);

  const weak = [...keyring.weakKeyIds, ...backupKeyring.weakKeyIds.map((id) => `backup ${id}`)];
  if (weak.length && !flag("--allow-weak-key")) {
    throw new Error(
      `Key ${weak.join(", ")} is shorter than ${MIN_SECRET_LENGTH} characters. ` +
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
    console.log(`Current backup key: ${backupKeyring.currentKeyId}`);
    for (const [id, key] of backupKeyring.keys) {
      console.log(`  backup key ${id}: ${keyFingerprint(key)}`);
    }

    const recorded = (await client.query("select key_id, fingerprint from public.encryption_keys order by key_id")).rows;
    const recordedBackup = (
      await client.query("select key_id, fingerprint from public.backup_encryption_keys order by key_id").catch(() => {
        throw new Error("Table backup_encryption_keys is missing. Apply azure/migrations/005_backup_encryption_keys.sql first.");
      })
    ).rows;
    console.log(recorded.length || recordedBackup.length ? "Already registered:" : "No keys registered yet.");
    for (const row of recorded) console.log(`  ${row.key_id}: ${row.fingerprint}`);
    for (const row of recordedBackup) console.log(`  backup ${row.key_id}: ${row.fingerprint}`);

    await confirmDatabase(database, `\nRegister any new key ids above in ${label}?`);
    const query = (sql, params) => client.query(sql, params);
    const added = [
      ...(await registerKeyFingerprints(keyring, query)),
      ...(await registerBackupKeyFingerprints(backupKeyring, query)).map((id) => `backup ${id}`),
    ];
    console.log(added.length ? `Registered: ${added.join(", ")}.` : "Nothing new to register; all keys match.");
  } finally {
    await client.end();
  }
});

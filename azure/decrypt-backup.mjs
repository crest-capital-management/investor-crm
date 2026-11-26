// Decrypts a CRM backup file (.json.gz.enc) on this PC, for emergencies or to
// look inside a backup outside the CRM. Needs BACKUP_ENCRYPTION_SECRET_KEY in
// .env.local (the same value as on the server); touches no database.
//   node azure/decrypt-backup.mjs <file.json.gz.enc>           -> <file.json.gz>
//   node azure/decrypt-backup.mjs <file.json.gz.enc> --json    -> <file.json> (unzipped)
//   node azure/decrypt-backup.mjs <file> --out=<path>          choose the output file
// Never overwrites an existing file. Prints the table row counts, never data.
//
// The result holds CRM data in readable form (personal-data columns stay
// encrypted with the personal-data key, the rest is plain): keep it safe and
// delete it when done. To restore, upload the .enc file itself on My Profile.
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { decryptBackup, isEncryptedBackup } from "../lib/backup-encryption.ts";
import { BACKUP_KEY_SETTING, loadBackupKeyring } from "../lib/keys.ts";
import { flag, loadEnv, option, run } from "./lib/script-env.mjs";

run(async () => {
  const input = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!input) throw new Error("Usage: node azure/decrypt-backup.mjs <file.json.gz.enc> [--json] [--out=<path>]");

  loadEnv();
  const keyring = await loadBackupKeyring(process.env);
  if (!keyring) throw new Error(`${BACKUP_KEY_SETTING} is not set (in .env.local).`);

  const bytes = fs.readFileSync(path.resolve(input));
  if (!isEncryptedBackup(bytes)) throw new Error("This file is not an encrypted CRM backup (it may already be plain).");

  const gzipped = decryptBackup(bytes, keyring);
  const json = gunzipSync(gzipped);
  const backup = JSON.parse(json.toString("utf8"));

  const asJson = flag("--json");
  const base = input.replace(/\.enc$/i, "");
  const output = path.resolve(option("--out", asJson ? base.replace(/\.gz$/i, "") : base));
  if (output === path.resolve(input)) throw new Error("Choose an output file with --out=<path>.");
  fs.writeFileSync(output, asJson ? json : gzipped, { flag: "wx" });

  console.log(`Decrypted to ${output}`);
  console.log(`Backup taken: ${backup.exportedAt ?? "unknown"}`);
  for (const [table, rows] of Object.entries(backup.data ?? {})) {
    console.log(`  ${table}: ${Array.isArray(rows) ? rows.length : "?"} rows`);
  }
  console.log("Keep this file safe and delete it when you no longer need it.");
});

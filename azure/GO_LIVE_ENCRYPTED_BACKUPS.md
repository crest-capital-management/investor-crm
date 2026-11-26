# Go-live: encrypted backups (TSK-38 package 5)

What goes live: every backup file is encrypted with `BACKUP_ENCRYPTION_SECRET_KEY`
(AES-256-GCM over the whole gzipped file, `lib/backup-encryption.ts`): the
nightly backup, Back up now, the safety copy before a restore, the "Full
backup" download on My Profile, and a file uploaded for a restore. New names
end in `.json.gz.enc` (prefix `crest-crm-backup-` unchanged, so the backup
check in `encrypt-columns.mjs` still finds them).

- Restore still reads the old plain backups (`.json.gz`, `.json`); they show
  as "(not encrypted)" in the list and age out with the 30-day cleanup. The
  first Back up now (or nightly run) replaces that day's plain backup.
- A downloaded backup is encrypted too. Restore it on My Profile as it is; to
  open one outside the CRM: `node azure/decrypt-backup.mjs <file>`
  (`azure/ENCRYPTION_KEYS.md`, "Backup files").
- The app **will not start** without `BACKUP_ENCRYPTION_SECRET_KEY`, with a
  key shorter than 32 characters, or with a key whose fingerprint does not
  match the one registered in the new table `backup_encryption_keys`.

**Database migration needed, before the deploy:**
`azure/migrations/005_backup_encryption_keys.sql` (the table for the backup
key's fingerprint). It is a separate table on purpose: the code running now
refuses to start if `encryption_keys` holds a key it hasn't loaded, so the
migration and the key registration are harmless for it (checked).

Tested on the local copy (26 Nov 2026) with a separate test storage container:
start-up loads and checks both keys (wrong backup key: refuses to start);
Back up now writes an encrypted file that `decrypt-backup.mjs` opens with
row counts equal to the database; the day's plain backup is replaced and a
backup older than 30 days pruned; restore preview of an old plain backup and
of an encrypted one; a real restore from an encrypted backup (safety copy
encrypted, all 12 tables identical afterwards); the "Full backup" download is
encrypted and restores via upload; an uploaded plain backup is stored
encrypted; a junk file is refused; the code from before this package still
starts with the backup key registered. 22 offline checks in
`node azure/verify-encryption.mjs`.

Who: **A** = Aditya (from his PC, project folder), **S** = Sharath (server).

## Before the day

| # | Who | Step | Check |
|---|---|---|---|
| 1 | S | Server `.env` has `BACKUP_ENCRYPTION_SECRET_KEY=v1:<secret>`, at least 32 characters after `v1:`, different from `PII_ENCRYPTION_SECRET_KEY`, and the **same value** as in Aditya's `.env.local`. Check without printing it: `grep -c '^BACKUP_ENCRYPTION_SECRET_KEY=v1:' .env` (1) and `awk -F'v1:' '/^BACKUP_ENCRYPTION_SECRET_KEY=/{print length($2)}' .env` (44 for an `openssl rand -base64 32` secret). | Both as expected. |
| 2 | S | Write down the commit the server runs now (`git rev-parse HEAD`): the rollback target. | |

## On the day (quiet time, about 15 minutes)

| # | Who | Step | Check |
|---|---|---|---|
| 1 | A | `node azure/run-sql.mjs azure/migrations/005_backup_encryption_keys.sql` (type `crest_crm`). | "Applied ...005_backup_encryption_keys.sql." |
| 2 | A | `node azure/register-keys.mjs` (type `crest_crm`). | "Registered: backup v1." (field keys: nothing new) |
| 3 | S | Deploy `master` as usual (pull, `npm ci`, `npm run build`, restart). | App log: `[encryption] Keys loaded and verified (current key "v1", backup key "v1").` |
| 4 | A | My Profile → Back up now. | Today's backup is listed without "(not encrypted)"; older ones are marked "(not encrypted)". |
| 5 | A | Download today's backup from the list, then `node azure/decrypt-backup.mjs <downloaded file>`. | Prints the row counts (about 3,100 contacts); delete the decrypted file afterwards. |
| 6 | A | My Profile → Restore… → pick today's backup → Check backup. **Do not restore**: Cancel. | The table shows the backup and current counts side by side, equal. |
| 7 | A | Next morning: My Profile lists the nightly backup (03:00) as encrypted. | |

If step 3 stops with "Backup encryption key "v1" is not the key this database
uses": the server's key differs from Aditya's. Put the right value in the
server `.env` and restart (never register a second key to work around it).

## If something goes wrong

1. S: deploy the commit from "Before the day" step 2, restart. The older code
   ignores `backup_encryption_keys`, so 005 and the registration can stay.
2. Note: the older code cannot read the new `.enc` backups (restore would
   say the file is not valid). The plain backups from before go-live still
   work with it. If an encrypted backup is needed with the older code, open it
   with `node azure/decrypt-backup.mjs <file> --json` and upload the `.json`.

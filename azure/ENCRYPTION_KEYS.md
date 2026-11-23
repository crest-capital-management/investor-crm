# CREST CRM: encryption keys (TSK-38)

Personal data in the database (names, phones, messages, notes, ...) is being
encrypted column by column with AES-256-GCM (`lib/encryption.ts`). This page
covers the keys: where they live, how to set them up, rotate them and not lose
them.

**If the key is lost, the encrypted data cannot be recovered.** Read "Do not
lose the key" before encrypting anything.

## The settings

Both are ordinary settings in the server's `.env` (and in `.env.local` on a PC
that works against the same database).

| Setting | Value | Used for |
|---|---|---|
| `PII_ENCRYPTION_SECRET_KEY` | `v1:<secret>` | Encrypting/decrypting personal-data columns, and (derived from it) the lookup hashes `phone_hash` / `email_hash`. |
| `BACKUP_ENCRYPTION_SECRET_KEY` | `v1:<secret>` | Encrypting backup files (package 5). |

- `v1` is the key's version. It is stored with every encrypted value, so a
  newer key (`v2`) can be added later while old data stays readable.
- The secret must be **at least 32 characters** of real randomness. A shorter
  secret is only accepted for testing: the app warns about it in development
  and **refuses to start with it in production**, and the scripts refuse to
  encrypt data or register it.
- The app turns the secret into separate 256-bit keys (HKDF-SHA256): one for
  encrypting, one for the lookup hashes.

Generate a proper secret (prints a new random one; run it on the server or
any PC with OpenSSL, e.g. Git Bash):

```bash
echo "v1:$(openssl rand -base64 32)"
```

Never send a real key by email or chat. Put it straight into the `.env` files.

## Same key everywhere

The server and every PC whose `.env.local` points at the live database must
have **exactly the same** `PII_ENCRYPTION_SECRET_KEY`. Data written with one
key can't be read with another.

The database stores only a **fingerprint** of each key (`encryption_keys`
table, never the key itself). The app and the scripts refuse to start if their
key doesn't match, so a wrong key can never write data nobody can read.

## One-time setup

1. Put the proper key in the server `.env` and in `.env.local`.
2. Apply the table and columns, then register the key fingerprints (from the PC):
   ```bash
   node azure/run-sql.mjs azure/migrations/001_encryption.sql
   node azure/register-keys.mjs
   ```
   Registering ties the key id (`v1`) to that key in this database **for
   good**. Never register a placeholder key on the live database
   (`register-keys.mjs` refuses short keys unless `--allow-weak-key`, which is
   for test databases only).
3. Restart the app. Its log should say
   `[encryption] Keys loaded and verified (current key "v1").`

## Encrypting a phase of columns

Order matters: **code first, data second.** The app reads plain and encrypted
values alike, so deploy the package's code, then encrypt that phase's data.

```bash
node azure/encrypt-columns.mjs 1 --dry-run     # counts and checks, changes nothing
node azure/encrypt-columns.mjs 1 --hash-only   # fill phone_hash/email_hash only
node azure/encrypt-columns.mjs 1               # encrypt (needs a backup < 6 h old)
node azure/encrypt-columns.mjs 1 --verify-only # decrypt every value once to check
```

Run it on a copy of the database first. The script refuses if the key doesn't
match, the key is too short, a column has an unexpected type, a trigger fires
on those columns, or there is no backup from the last 6 hours
(Settings → Back up now).

## Rotating the key

1. Generate a new secret and put the new key **first**, keeping the old one:
   `PII_ENCRYPTION_SECRET_KEY=v2:<new secret>,v1:<old secret>`
   (same value on the server and in `.env.local`).
2. `node azure/register-keys.mjs` (registers `v2`).
3. Restart the app. New values use `v2`; old `v1` values still read.
4. Keep `v1` in the list. It is also the source of the lookup-hash key (the
   **last** key in the list always is), so removing it would break phone and
   email lookups and is refused at start-up.

## Do not lose the key

- Keep an **offline copy** of both settings somewhere separate from the server
  (e.g. printed and stored in the office safe, or a company password manager
  with restricted access). Update it after every rotation.
- The server `.env` is the only other copy. Include it in whatever protects the
  server (VM backups/snapshots), with restricted access.
- Database backups are only useful together with the keys from the same time.

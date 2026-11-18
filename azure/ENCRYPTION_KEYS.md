# CREST CRM: encryption keys (TSK-38)

Personal data in the database (names, phones, messages, notes, ...) is being
encrypted column by column with AES-256-GCM (`lib/encryption.ts`). This page
covers the keys: where they live, how to set them up, rotate them and not lose
them.

**If the keys are lost, the encrypted data cannot be recovered. Not by us, not
by Microsoft.** Read "Do not lose the keys" before encrypting anything.

## The two secrets

Both live in **Azure Key Vault**. The app reads them once at start-up.

| Secret name | Value | Used for |
|---|---|---|
| `crm-field-keys` | JSON: `{"current":"k1","keys":{"k1":"<base64 of 32 random bytes>"}}` | Encrypting/decrypting columns. `current` is used for new values; every key listed can still be read. |
| `crm-index-key` | `<base64 of 32 random bytes>` | Lookup hashes (`phone_hash`, `email_hash`) so phone/email can still be searched exactly. Must differ from every field key. |

The database stores only a **fingerprint** of each key (`encryption_keys`
table, never the key). The app and the scripts refuse to start if their keys
don't match those fingerprints, so a wrong key can never write data nobody can
read.

## One-time setup (someone with Azure access)

1. **Create the vault** (or use an existing one) in the same subscription, with
   *Azure role-based access control* permissions. Turn on **soft delete** and
   **purge protection** (both protect against accidental deletion of the keys).
2. **Give the server an identity**: on the VM (98.70.30.45) turn on the
   *system-assigned managed identity*.
3. **Grant access**: on the vault, *Access control (IAM)* → add role
   **Key Vault Secrets User** to the VM's identity. For whoever runs the
   scripts in `azure/` from a PC (`az login`), add the same role to their account.
   Whoever creates the secrets needs **Key Vault Secrets Officer**.
4. **Create the secrets** (Azure Cloud Shell or a PC with the Azure CLI; the keys
   are generated and stored in one step and never printed):
   ```bash
   VAULT=<vault-name>
   az keyvault secret set --vault-name "$VAULT" --name crm-field-keys \
     --value "{\"current\":\"k1\",\"keys\":{\"k1\":\"$(openssl rand -base64 32)\"}}" --output none
   az keyvault secret set --vault-name "$VAULT" --name crm-index-key \
     --value "$(openssl rand -base64 32)" --output none
   ```
5. **Server setting**: add `KEY_VAULT_URL=https://<vault-name>.vault.azure.net/`
   to the app's `.env` on the server.
6. **Database**: apply the table and columns, then register the key fingerprints
   (from a PC with `az login` and `KEY_VAULT_URL` in `.env.local`):
   ```bash
   node azure/run-sql.mjs azure/migrations/001_encryption.sql
   node azure/register-keys.mjs
   ```
7. Restart the app. Its log should say
   `[encryption] Keys loaded and verified (current key "k1").`

## Development PCs

`.env.local` on a development PC points at the **live** database. So a PC must
use the **same** keys as the server: put `KEY_VAULT_URL` in `.env.local` and run
`az login` (account needs *Key Vault Secrets User*). Never put real keys into
`.env.local`.

`CRM_FIELD_KEYS` / `CRM_INDEX_KEY` (same formats as the secrets) are only for a
**separate test database**. They are refused when `NODE_ENV=production`, and
`register-keys.mjs` only registers them with `--dev-keys`. If they ever reach
the live database by mistake, the fingerprint check stops the app before it
writes anything.

## Encrypting a phase of columns

Order matters: **code first, data second.** The app reads plain and encrypted
values alike, so deploy the package's code, then encrypt that phase's data.

```bash
node azure/encrypt-columns.mjs 1 --dry-run     # counts and checks, changes nothing
node azure/encrypt-columns.mjs 1 --hash-only   # fill phone_hash/email_hash only
node azure/encrypt-columns.mjs 1               # encrypt (needs a backup < 6 h old)
node azure/encrypt-columns.mjs 1 --verify-only # decrypt every value once to check
```

Run it on a copy of the database first. The script refuses if the keys don't
match, a column is not `text`, the table still has triggers, or there is no
backup from the last 6 hours (Settings → Back up now).

## Rotating the field key

1. Add a new key and make it current, keeping the old one:
   `{"current":"k2","keys":{"k1":"<old>","k2":"<new>"}}` (new secret version).
2. `node azure/register-keys.mjs` (registers `k2`).
3. Restart the app. New values use `k2`; old `k1` values still read.
4. Optional, later: re-encrypt old values with `k2`, then remove `k1` from the
   secret **and** its row in `encryption_keys`. Until then keep `k1`.

The index key cannot simply be rotated: every `phone_hash`/`email_hash` would
have to be recomputed. Only change it with a planned re-hash.

## Do not lose the keys

- Purge protection on the vault (setup step 1) stops the secrets being deleted
  for good by mistake.
- Keep an **offline copy** of both secret values somewhere separate from Azure
  (e.g. printed and stored in the office safe, or a company password manager
  with restricted access). Update it after every rotation.
- Backups of the database are only useful together with the keys from the
  same time. A backup made before a key was removed needs that old key.

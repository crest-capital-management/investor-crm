# Go-live: encryption phase 1 (TSK-38 packages 0–2)

What goes live: security foundations (startup checks, HSTS, id checks), the
encryption core, and phase 1 encryption (contact names and phones, WhatsApp
messages and numbers, broadcast texts and recipients, follow-up messages,
portfolio analyses).

Tested on a full local copy of `crest_crm` (23 Nov 2026): encrypt, every page,
search, export, webhook, add/edit/import/update contacts, follow-ups, groups,
broadcast draft, rollback to plain text, encrypt again.

Who: **A** = Aditya (from his PC, project folder), **S** = Sharath (server).

## Already done on live

- Migration 001 (key table, hash columns) and 002 (last-message trigger).
- Keys registered (`v1`, `index`); same `PII_ENCRYPTION_SECRET_KEY` and
  `BACKUP_ENCRYPTION_SECRET_KEY` in the server `.env` and in A's `.env.local`.

## Before the day

| # | Who | Step |
|---|---|---|
| 1 | A | Merge the code into `master` (one PR from `sec/enc-phase-1`, which contains `multi-user-login`, `sec/foundations` and `sec/encryption-core`). |
| 2 | S | Check the server `.env`: `NEXTAUTH_SECRET` at least 32 characters, `SCHEDULER_SECRET` at least 16, `META_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `PII_ENCRYPTION_SECRET_KEY` present. Missing or short values stop the app from starting. |
| 3 | S | `grep -rn "Strict-Transport-Security" /etc/nginx/` — if nginx already sets it, tell A (the app now sends it too). |
| 4 | S | Write down the commit the server runs now (`git rev-parse HEAD` in the app folder): that is the rollback target. |

## On the day (quiet time, about 30 minutes)

| # | Who | Step | Check |
|---|---|---|---|
| 1 | A | Settings → Back up now. | A backup with today's date is listed. |
| 2 | S | Deploy `master` as usual (pull, `npm ci`, `npm run build`, restart). | App log shows `[encryption] Keys loaded and verified (current key "v1")`. |
| 3 | A | Open the site: dashboard, contacts, one contact's chat. | Everything loads and reads normally. |
| 4 | A | `node azure/encrypt-columns.mjs 1 --hash-only` (type `crest_crm`). | "All checks passed." |
| 5 | A | `node azure/encrypt-columns.mjs 1 --dry-run` | No "would refuse" lines; counts look like the local test (≈3,100 contacts). |
| 6 | A | `node azure/encrypt-columns.mjs 1` (type `crest_crm`). Needs the backup from step 1 (under 6 h old). | Ends with every column "encrypted, 0 plain OK" and "All checks passed." |
| 7 | A | Click through on live: contacts and investors (search a name and a phone), a contact's chat, groups, follow-ups, broadcasts, unread messages, export. | All readable; nothing looks like `enc:v1:…`. |
| 8 | A | Checks the local test could not do, using your own phone number as the contact: send yourself a WhatsApp reply; send yourself a message (incoming); a broadcast to a group with only you in it; one portfolio analysis (paste text). | Each works and shows normally. |
| 9 | A | DBeaver (read only) on `crest_crm`: `contacts.name` / `phone` start with `enc:v1:`. | Data is encrypted at rest. |

Note: from step 2 on, run the scripts **without** `--local` (they work on the
live database from `.env.local`). `.env.development.local` only affects
`npm run dev`.

## If something goes wrong

The old code cannot read encrypted values, so a rollback is always: decrypt
first, then put the old code back.

1. A: Settings → Back up now (the decrypt refuses without a backup under 6 h old).
2. A: `node azure/encrypt-columns.mjs 1 --decrypt --dry-run`, then
   `node azure/encrypt-columns.mjs 1 --decrypt` (type `crest_crm`).
   Ends with "All values are plain text again." This also covers rows the new
   code wrote between steps 2 and 6, and the last-message previews.
3. S: deploy the commit written down in "Before the day" step 4, restart.

Nothing else needs undoing: migrations 001/002, the hash columns and the key
table are ignored by the old code.

If the app does not start after step 2 (bad `.env` value), nothing has been
encrypted yet: fix the value and restart, or deploy the old commit. No decrypt needed.

## Afterwards

- Keep the offline copy of both keys up to date.
- `crest_crm_local` on A's PC holds a full copy of the CRM data: delete it when
  testing is finished (DBeaver: drop database `crest_crm_local`), and delete
  `.env.development.local`.

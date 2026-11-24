# Go-live: encryption phase 2 (TSK-38 package 3)

Only after phase 1 is live and settled (`GO_LIVE_ENCRYPTION_PHASE1.md`).

What goes live: encryption of contact emails (with an `email_hash` lookup
hash), contact notes, WhatsApp chat summaries, meeting notes, WhatsApp profile
names, broadcast recipient emails, login names (`crm_users.name`) and the
reminder email address in Settings. Login emails (`crm_users.email`) stay plain,
because sign-in looks them up.

No database migration: `email_hash` and its index came with migration 001.
"Update from file" no longer calls the `bulk_update_contacts` database function
(it could not fill `email_hash`); the function stays in the database, unused.
`azure/set-password.js` is now `azure/set-password.mjs` and needs
`PII_ENCRYPTION_SECRET_KEY` in `.env.local`.

Tested on a full local copy of `crest_crm` (24 Nov 2026), phase 1 and then
phase 2 encrypted: every page and API list free of `enc:v1:`, search by email
(any capitals), add contact, edit contact, update from file, meeting note,
Settings save, a new login via `set-password.mjs`, rollback (`2 --decrypt`)
and encrypting again. Not tested locally: an incoming WhatsApp message from an
unknown number (the profile name) and a real broadcast (recipient emails).

Who: **A** = Aditya (from his PC, project folder), **S** = Sharath (server).

## Before the day

| # | Who | Step |
|---|---|---|
| 1 | A | Merge the code into `master` (PR from `sec/enc-phase-2`). |
| 2 | S | Write down the commit the server runs now (`git rev-parse HEAD`): that is the rollback target. |

## On the day (quiet time, about 20 minutes)

| # | Who | Step | Check |
|---|---|---|---|
| 1 | A | Settings → Back up now. | A backup with today's date is listed. |
| 2 | S | Deploy `master` as usual (pull, `npm ci`, `npm run build`, restart). | App log shows `[encryption] Keys loaded and verified`. |
| 3 | A | `node azure/encrypt-columns.mjs 2 --hash-only` (type `crest_crm`). | "All checks passed." |
| 4 | A | `node azure/encrypt-columns.mjs 2 --dry-run` | No "would refuse" lines; about 2,900 emails, 1,500 notes. |
| 5 | A | `node azure/encrypt-columns.mjs 2` (type `crest_crm`). Needs the backup from step 1 (under 6 h old). | Every column "encrypted, 0 plain OK", then "All checks passed." |
| 6 | A | Click through on live: contacts (search part of an email), a contact's notes and meeting notes, the WhatsApp summary, My Profile (your name, the reminder email), unread messages, export. | All readable; nothing looks like `enc:v1:…`. |
| 7 | A | With your own number: send yourself a WhatsApp message from a phone whose number is **not** saved in the CRM, and check Unread messages shows the sender's WhatsApp name. Settings → Send test reminder email. | Both work. |

## If something goes wrong

1. A: Settings → Back up now.
2. A: `node azure/encrypt-columns.mjs 2 --decrypt --dry-run`, then
   `node azure/encrypt-columns.mjs 2 --decrypt` (type `crest_crm`).
   Ends with "All values are plain text again."
3. S: deploy the commit from "Before the day" step 2, restart.

The phase 1 code also decrypts whatever it reads, so if only the phase 2 code
has a problem, step 3 alone is enough; step 2 is needed before going back to
code from before encryption.

## Afterwards

- Refresh or drop `crest_crm_local` on A's PC: it now holds phase 1 and 2
  encrypted (from the 24 Nov test).

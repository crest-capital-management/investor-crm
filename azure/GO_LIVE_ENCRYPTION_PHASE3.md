# Go-live: encryption phase 3 (TSK-38 package 4)

Only after phase 2 is live and settled (`GO_LIVE_ENCRYPTION_PHASE2.md`, done 25 Nov 2026).

What goes live: encryption of contact companies, the "last message" preview
(`contacts.last_message_text`), the AI and manual score reasons, contact tags,
portfolio update titles, file paths and file names, and WhatsApp media addresses
(`whatsapp_messages.media_url`).

Tags are a list (`text[]`): each tag is encrypted on its own, and a new column
`contacts.tag_hashes` holds one lookup hash per tag, so the tag filters
(Contacts, Investors, the investor counts, section counts, broadcast audiences
by tag) still run in the database. Bulk tag changes no longer call the
`bulk_change_contact_tags` database function (it can't compare encrypted
tags); the function stays in the database, unused.

**Database migration needed, before the deploy:**
`azure/migrations/003_encrypted_tags.sql` adds `contacts.tag_hashes` (with an
index) and changes the "last message" trigger so it never writes the plain
word "Attachment" (the Contacts list already shows "Attachment" when the
preview is empty). The migration works with the code that runs now.

Tested on a full local copy of `crest_crm` (25 Nov 2026, phases 1 and 2 already
encrypted): migration 003, the new code on plain phase 3 data, `--hash-only`,
then the real run. Every page and API list free of `enc:v1:`; contact, tag
filter (Leads 278, PMS 18, PMS + RIA 48, Shareholders 3) and search counts the
same before and after; the contacts list, investors list and contacts export
byte-identical before and after. Write paths checked in the database (rolled
back): add contact, tag filter, plain-tag fallback, bulk tag change, update
from file with and without tags, import, score reason, pasted portfolio
update, the trigger with an attachment and with text. Rollback
(`3 --decrypt`) and encrypting again. Not tested locally (needs live storage /
WhatsApp): opening a stored WhatsApp file, downloading a portfolio file, a new
incoming photo, a broadcast to a tag.

Who: **A** = Aditya (from his PC, project folder), **S** = Sharath (server).

## Before the day

| # | Who | Step |
|---|---|---|
| 1 | A | Merge the code into `master` (PR from `sec/enc-phase-3`). |
| 2 | S | Write down the commit the server runs now (`git rev-parse HEAD`): that is the rollback target. |

## On the day (quiet time, about 25 minutes)

| # | Who | Step | Check |
|---|---|---|---|
| 1 | A | Settings → Back up now. | A backup with today's date is listed. |
| 2 | A | `node azure/run-sql.mjs azure/migrations/003_encrypted_tags.sql` (type `crest_crm`). | "Applied azure/migrations/003_encrypted_tags.sql." |
| 3 | S | Deploy `master` as usual (pull, `npm ci`, `npm run build`, restart). | App log shows `[encryption] Keys loaded and verified`. |
| 4 | A | `node azure/encrypt-columns.mjs 3 --hash-only` (type `crest_crm`). | "All checks passed." (about 3,100 rows of tag hashes) |
| 5 | A | `node azure/encrypt-columns.mjs 3 --dry-run` | No "would refuse" lines; about 1,500 companies, 3,100 tag lists, 160 previews. |
| 6 | A | `node azure/encrypt-columns.mjs 3` (type `crest_crm`). Needs the backup from step 1 (under 6 h old). | Every column "encrypted, 0 plain OK", then "All checks passed." |
| 7 | A | Click through on live: Contacts (tags on each row, filter by a tag, search a company name), Investors (count as before), a contact page (company, tags, score reason, portfolio updates), the dashboard, Unread messages, Broadcasts → New (audience by tag shows the same count as before), export. | All readable; nothing looks like `enc:v1:…`. |
| 8 | A | On your test contact: add a tag and remove it; open a stored photo or file in the WhatsApp history; download a portfolio file. | All work. |

## If something goes wrong

1. A: Settings → Back up now.
2. A: `node azure/encrypt-columns.mjs 3 --decrypt --dry-run`, then
   `node azure/encrypt-columns.mjs 3 --decrypt` (type `crest_crm`).
   Ends with "All values are plain text again." This also empties
   `contacts.tag_hashes` (the older code would let them go stale).
3. S: deploy the commit from "Before the day" step 2, restart.

Unlike the earlier phases, **step 2 is needed even if only the code has a
problem**: the phase 2 code reads encrypted text columns, but not encrypted
tags (it would show `enc:v1:…` as tags and the tag filters would find
nothing). Migration 003 can stay; it works with the older code.

To go live again later: deploy, then start from step 4 (`--hash-only`).

## Afterwards

- Refresh or drop `crest_crm_local` on A's PC: it now holds phases 1 to 3
  encrypted (from the 25 Nov test).

# CREST CRM: switch-over to the Azure server

> **Done on 5 Nov 2026; kept as a record.** The copy scripts it mentions
> (`azure/copy-data.js`, `azure/copy-files.js`) and the Netlify functions were
> removed from the repository afterwards; they are still in git history. The
> cron lines below are the live setup.

Goal: the team uses only **https://investor-crm.crest-capital.com** (Azure server, port 3002),
with data in `crest_crm`, logins in `crm_users`, and files in Azure Blob Storage. Netlify and
Supabase are retired.

Who: **A** = Aditya (with Claude on his PC), **S** = Sharath (server).

## Before the day

| # | What | Who | Done when |
|---|---|---|---|
| 1 | PR #3 (Phases 2+3) merged and deployed on the server | S | `https://investor-crm.crest-capital.com/api/auth/csrf` answers 200 (today 404) |
| 2 | Server settings from `azure/SERVER_ENV.md` sections A and B, and nginx `client_max_body_size 20m;` + `X-Forwarded-For` | S | |
| 3 | The server's `AZURE_CONNECTION_STRING` points at **`crest_crm`** (confirm, since the copy scripts write there) | S | |
| 4 | Owner login on the server: `crm_users` has the owner row (it is in `crest_crm` already if the server uses it; otherwise `node azure/set-password.js` on the server) | A/S | A can log in at the company address |
| 5 | Agree a quiet time (about 1 hour) and tell the team not to use the CRM during it | A | |

## On the day (in this order)

Order matters: everything that writes to Supabase stops **before** the final copy, and the
new server starts receiving **after** it, so nothing is lost or copied twice.

| # | Step | Who | Command / where |
|---|---|---|---|
| 1 | **Freeze Netlify.** Netlify → the CRM site → **Site configuration → Environment variables**: **delete** `SCHEDULER_SECRET` (write its value down somewhere safe first, for the way back), then **Deploys → Trigger deploy → Deploy site** and wait for **Published**. The 3 scheduled jobs (broadcasts, reminder email, backup) then stop with "SCHEDULER_SECRET is not set" (changing the value would not stop them: the jobs and the site read the same variable). Then **Site configuration → Build & deploy → Stop builds**, so no later push can redeploy Netlify. Nothing is deleted. | A | Netlify dashboard |
| 2 | Check nothing is mid-send: no broadcast in `sending` / due `scheduled` (Claude checks read-only) | A | `node azure/copy-data.js --verify-only` and a broadcast status query |
| 3 | **Final data copy** Supabase → `crest_crm` (replaces the 11 CRM tables in one transaction; logins untouched), then compare | A | `node azure/copy-data.js --replace` (prints the comparison at the end) |
| 4 | **Final file copy** Supabase Storage → Azure (only new or changed files), then compare | A | `node azure/copy-files.js` then `node azure/copy-files.js --check` |
| 5 | **WhatsApp webhook → server.** Meta for Developers → the app → **WhatsApp → Configuration → Webhook → Edit**: Callback URL `https://investor-crm.crest-capital.com/api/whatsapp/webhook`, Verify token = the server's `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → **Verify and save**. Keep the `messages` field subscribed. | A | Meta dashboard |
| 5b | **Gap check.** Between step 3 and step 5 incoming WhatsApp messages still went to Netlify/Supabase. Claude compares `whatsapp_messages` again (`--verify-only`); if Supabase got new rows in those minutes, Claude copies just those rows (by id) into `crest_crm` | A + Claude | |
| 6 | **Scheduled jobs on the server** (cron as the app user; times are IST, so set `CRON_TZ=Asia/Kolkata` or convert) | S | see "Cron lines" below |
| 7 | **Smoke test** on the company address: log in, dashboard numbers, open a contact, WhatsApp history, send a test WhatsApp to an own number inside its 24-hour window, receive a reply (arrives through the new webhook), Back up now, upload + delete a test portfolio file | A + Claude | |
| 8 | Tell the team: use only `https://investor-crm.crest-capital.com` | A | |

### Cron lines (step 6)

```
CRON_TZ=Asia/Kolkata
*/5 * * * *  curl -fsS -X POST -H "Authorization: Bearer $SCHEDULER_SECRET" http://localhost:3002/api/broadcasts/trigger  >/dev/null
0 10 * * *   curl -fsS -X POST -H "Authorization: Bearer $SCHEDULER_SECRET" http://localhost:3002/api/follow-ups/trigger  >/dev/null
0 3 * * *    curl -fsS -X POST -H "Authorization: Bearer $SCHEDULER_SECRET" http://localhost:3002/api/backup/trigger      >/dev/null
```
`SCHEDULER_SECRET` must be the server's value (put it in the crontab's environment or a root-only file; never in a world-readable script).

## If something goes wrong (way back)

Possible until step 8, and for a short while after:
1. Meta webhook back to the Netlify address (`https://investor-crm.netlify.app/api/whatsapp/webhook`).
2. Netlify: **Start builds**, add `SCHEDULER_SECRET` back with its old value, Trigger deploy.
3. The team goes back to `investor-crm.netlify.app`.
Anything entered on the new server in between exists only in `crest_crm` and must be re-entered (or copied back by hand), so decide quickly.

## After the switch-over

| When | What | Who |
|---|---|---|
| Same day | Netlify's scheduled jobs are already off (step 1). Leave the Netlify site up but frozen for 2 weeks, as the way back | A |
| After 1–2 weeks without problems | **Delete the Netlify site** (Site configuration → Danger zone → Delete site), so the old address stops working | A |
| Same time | Remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` from the server env and `.env.local` | S / A |
| Keep 30 days | Supabase project stays as a read-only safety copy (download a final backup from it), then pause or delete it | A |
| As soon as possible | Rotate the storage account key (it was emailed) and update the server env + `.env.local` | S |
| When the Anthropic key arrives | Move the AI features from Gemini to Claude | A + Claude |

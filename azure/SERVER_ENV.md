# CREST CRM: settings (.env) for the Azure server

Names only. Never commit real values. The app runs on port 3002 behind nginx at
https://investor-crm.crest-capital.com.

## A. Needed now, for PR #2 (Phase 1: database)

| Name | Value |
|---|---|
| `AZURE_CONNECTION_STRING` | `postgresql://crest:<db password>@localhost:5432/crest_crm` (the CRM's own database, not `crest`) |
| `CRM_OWNER_ID` | The owner's user id (Aditya has it; same value as in his `.env.local`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as Netlify (Phase 1 still logs in and stores files through Supabase) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as Netlify |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as Netlify |
| `WHATSAPP_ACCESS_TOKEN` | Same as Netlify |
| `WHATSAPP_PHONE_NUMBER_ID` | Same as Netlify |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Same as Netlify |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Same as Netlify |
| `META_APP_SECRET` | Same as Netlify (checks that webhook calls really come from Meta) |
| `SCHEDULER_SECRET` | Same as Netlify (the scheduled jobs send it) |
| `GEMINI_API_KEY` | Same as Netlify (AI features) |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Same as Netlify (email) |
| `BREVO_SENDER_NAME` | Optional, default "CREST CRM" |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional fallback email service, same as Netlify |
| `REMINDER_EMAIL_TO` | Where the daily reminder email goes, same as Netlify |
| `URL` | `https://investor-crm.crest-capital.com` (links in the PDF auto-reply; Netlify set this itself) |

Not needed on the server: `DATABASE_SSL_NO_VERIFY` (the database is on the same machine, so no TLS is used), `DATABASE_URL` (old name for `AZURE_CONNECTION_STRING`). Optional: `DATABASE_POOL_MAX` (default 10).

## B. Added later, with Phase 2 (login) and Phase 3 (files)

| Name | Value |
|---|---|
| `NEXTAUTH_SECRET` | A new long random value made on the server: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXTAUTH_URL` | `https://investor-crm.crest-capital.com` |
| `AZURE_STORAGE_CONNECTION_STRING` | The storage account connection string with its access key (account `crestfinancialreports`) |

After Phase 3 the three Supabase settings are no longer used by the app and can be removed.

## Also needed on the server

- **nginx** must pass `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`); the login lockout uses it.
- **Scheduled jobs** (were Netlify functions): a cron/timer that sends `POST` with header `Authorization: Bearer <SCHEDULER_SECRET>` to
  - `/api/broadcasts/trigger` every 5 minutes,
  - `/api/follow-ups/trigger` daily at 10:00 IST,
  - `/api/backup/trigger` daily at 03:00 IST.
- **Data refresh before going live:** `crest_crm` holds a copy of the live data from 4 Nov 2026; copy again right before switching (`azure/copy-data.js`).

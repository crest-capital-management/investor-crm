# CREST CRM: settings (.env) for the Azure server

Names only. Never commit real values. The app runs on port 3002 behind nginx at
https://investor-crm.crest-capital.com.

The switch-over finished on 5 Nov 2026: database, login and files all run on
Azure. The Supabase settings (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are not read by
the app any more and can be removed from the server.

## A. App settings

| Name | Value |
|---|---|
| `AZURE_CONNECTION_STRING` | `postgresql://crest:<db password>@localhost:5432/crest_crm` (the CRM's own database, not `crest`) |
| `CRM_OWNER_ID` | The owner's user id (Aditya has it; same value as in his `.env.local`) |
| `WHATSAPP_ACCESS_TOKEN` | Same as Netlify |
| `WHATSAPP_PHONE_NUMBER_ID` | Same as Netlify |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Same as Netlify |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Same as Netlify |
| `META_APP_SECRET` | Same as Netlify (checks that webhook calls really come from Meta) |
| `SCHEDULER_SECRET` | Same as Netlify (the scheduled jobs send it) |
| `ANTHROPIC_API_KEY` | AI features (Claude): chat summary, follow-up suggestion, message drafting, prospect scoring, portfolio analysis. Holds the **Anthropic** key |
| `GEMINI_API_KEY` | Voice note → meeting note only (Claude does not take audio, so this one feature stays on Google Gemini). Holds the **Gemini** key; without it only voice notes stop working |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Same as Netlify (email) |
| `BREVO_SENDER_NAME` | Optional, default "CREST CRM" |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional fallback email service, same as Netlify |
| `REMINDER_EMAIL_TO` | Where the daily reminder email goes, same as Netlify |
| `URL` | `https://investor-crm.crest-capital.com` (links in the PDF auto-reply; falls back to `NEXTAUTH_URL` if unset) |

Not needed on the server: `DATABASE_SSL_NO_VERIFY` (the database is on the same machine, so no TLS is used), `DATABASE_URL` (old name for `AZURE_CONNECTION_STRING`). Optional: `DATABASE_POOL_MAX` (default 10).

## B. Login and files

| Name | Value |
|---|---|
| `NEXTAUTH_SECRET` | A new long random value made on the server: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXTAUTH_URL` | `https://investor-crm.crest-capital.com` |
| `AZURE_STORAGE_CONNECTION_STRING` | The storage account connection string with its access key (account `crestfinancialreports`) |

## Also needed on the server

- **nginx** must pass `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`); the login lockout uses it.
- **nginx upload size** (Phase 3): file uploads go through the app (`/api/uploads`), up to 16 MB, so set `client_max_body_size 20m;` (nginx's default is 1 MB, which would reject most files).
- **Scheduled jobs** (were Netlify functions): a cron/timer that sends `POST` with header `Authorization: Bearer <SCHEDULER_SECRET>` to
  - `/api/broadcasts/trigger` every 5 minutes,
  - `/api/follow-ups/trigger` daily at 10:00 IST,
  - `/api/backup/trigger` daily at 03:00 IST.

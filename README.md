# CREST Capital Management - Investor CRM

An internal CRM for CREST Capital Management. It tracks investors, advisors and prospects across meetings, follow-ups and WhatsApp conversations.

Live at https://investor-crm.crest-capital.com (Azure server, behind nginx, app on port 3002).

## Features

- **Contacts**: create, edit, search, soft-delete; tags, custom groups and sections (tabs); CSV/Excel import with column mapping and duplicate checks; bulk update from a spreadsheet; CSV/Excel export.
- **Investors** (`/investors`): pipeline view of investor-tagged contacts, with "going quiet" tracking.
- **Contact / investor detail**: meeting notes (typed or voice note → transcript), follow-ups with AI suggestions, full WhatsApp chat with replies and media, AI chat summary, AI message drafting, prospect score, portfolio updates with AI analysis.
- **WhatsApp (Meta Cloud API, direct, Coexistence mode)**: inbound webhook with delivery statuses, broadcasts (group/tag/manual targeting, scheduling, per-recipient results, retry failed), templates synced from Meta, unread inbox and unknown numbers, PDF auto-reply to a template button.
- **Dashboard**: KPIs, follow-up trend, tag distribution, upcoming follow-ups.
- **My Profile / settings**: change your password, daily reminder email, backups (encrypted download, stored nightly backups, restore with password confirmation).
- **Security** (VAPT fixes, TSK-38): personal data encrypted in the database (AES-256-GCM), encrypted backup files, Content-Security-Policy with a per-request nonce, sign-in with a code sent by email (package 7b), sessions that end on a password change, an API check in `proxy.ts`, HSTS, startup checks of required secrets, id validation on every server action. Status per package: `HANDOFF.md`, section 00.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS v4, Base UI (`@base-ui/react`) with shadcn/ui components, Lucide icons, recharts |
| Database | PostgreSQL on the Azure server (`crest_crm`), accessed with `pg` (`lib/db.ts`) |
| Login | NextAuth (credentials): password, then a 6-digit code by email (`app/login/actions.ts`, `lib/login-codes.ts`); accounts in `crm_users`; sessions checked in `proxy.ts` and `lib/auth.ts` (`lib/session.ts`) |
| Encryption | Field encryption in `lib/encryption.ts`, decrypted automatically on read in `lib/db.ts`; key from `PII_ENCRYPTION_SECRET_KEY` (`azure/ENCRYPTION_KEYS.md`) |
| Files | Azure Blob Storage (`lib/storage.ts`), private containers with short-lived signed links |
| AI | Claude (`@anthropic-ai/sdk`, `lib/claude.ts`); Gemini only for voice-note transcription (`lib/gemini.ts`) |
| Email | Brevo, with Resend as fallback (`lib/resend.ts`) |

## Database

The whole schema is `azure/schema.sql` (one transaction, for an empty database). After applying it, register the encryption key with `node azure/register-keys.mjs` and create a login with `node azure/set-password.mjs`. The old Supabase migrations are in git history only.

Changes to an existing database are numbered files in `azure/migrations/`, applied with `node azure/run-sql.mjs azure/migrations/<file>.sql` (it asks you to type the database name). They are also folded into `schema.sql`.

### Encrypted data

Personal data is stored encrypted as `enc:v1:...`. Live since 25 Nov 2026: phase 1 (contact names and phones, WhatsApp messages and numbers, broadcast texts and recipients, follow-ups, portfolio analyses) and phase 2 (contact emails and notes, WhatsApp summaries and profile names, meeting notes, recipient emails, login names, the reminder email address). Phase 3 (company, tags, last-message text, score reasons, portfolio file details, media links) is live too (package 4, 26 Nov; `azure/GO_LIVE_ENCRYPTION_PHASE3.md`). Login emails (`crm_users.email`) stay plain because sign-in looks them up. The app encrypts on write and decrypts on read, so the CRM shows it normally; in DBeaver or a raw query it is unreadable. Phone, email and tag lookups use keyed hashes (`phone_hash`, `email_hash`, `tag_hashes`).

- **Key:** `PII_ENCRYPTION_SECRET_KEY` (and `BACKUP_ENCRYPTION_SECRET_KEY` for backups) must be the same on the server and in every `.env.local` that uses the live database. **Losing it means losing the encrypted data**: keep the offline copy up to date. The app refuses to start without the right key.
- **Encrypting existing rows** (per phase): `node azure/encrypt-columns.mjs <phase>` with `--dry-run`, `--hash-only`, `--verify-only`, or `--decrypt` to roll back.
- Setup, rotation and key safety: `azure/ENCRYPTION_KEYS.md`. Go-live steps and rollback: `azure/GO_LIVE_ENCRYPTION_PHASE1.md`, `azure/GO_LIVE_ENCRYPTION_PHASE2.md`.

## Scheduled jobs

A cron job on the server sends `POST` with `Authorization: Bearer <SCHEDULER_SECRET>` to:

- `/api/broadcasts/trigger` every 5 minutes (scheduled broadcasts)
- `/api/follow-ups/trigger` daily at 10:00 IST (reminder email)
- `/api/backup/trigger` daily at 03:00 IST (backup to the `backups` container)

See `azure/SWITCHOVER.md` for the exact crontab.

## Local development

Prerequisites: Node.js 20+ and npm.

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the values, including the encryption keys (same values as the server). `azure/SERVER_ENV.md` explains each one. **Note:** a `.env.local` pointing at the server's database works on live data.

```bash
npm run dev
```

Open http://localhost:3000. Logins: `node azure/set-password.mjs` (add a login or reset a password) and `node azure/delete-user.mjs` (remove one); users change their own password on My Profile. Without an email provider (the local copy), the sign-in code is printed in the `npm run dev` terminal.

Before committing:

```bash
npm run lint
npm run build
```

Inbound WhatsApp messages need a public URL, so they only arrive on the live server (or through a tunnel such as ngrok).

### Testing on a local copy of the database

To try a migration or a risky change without touching live data:

1. Install PostgreSQL 16 (the server's version), e.g. `winget install PostgreSQL.PostgreSQL.16`, and give the `postgres` user a password.
2. Add to `.env.local`: `LOCAL_DATABASE_URL=postgresql://postgres:<that password>@localhost:5432/crest_crm_local`
3. `node azure/copy-to-local.mjs` copies the live database into `crest_crm_local` (live is only read) and writes `.env.development.local`, so `npm run dev` uses the copy with WhatsApp sending, file storage and email switched off.
4. Run the `azure/` scripts with `--local` to work on the copy, e.g. `node azure/encrypt-columns.mjs 1 --dry-run --local`.
5. Afterwards delete `.env.development.local` (so `npm run dev` uses live again) and drop `crest_crm_local` (it holds all CRM data).

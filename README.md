# CREST Capital Management - Investor CRM

An internal, single-owner CRM for CREST Capital Management. It tracks investors, advisors and prospects across meetings, follow-ups and WhatsApp conversations.

Live at https://investor-crm.crest-capital.com (Azure server, behind nginx, app on port 3002).

## Features

- **Contacts**: create, edit, search, soft-delete; tags, custom groups and sections (tabs); CSV/Excel import with column mapping and duplicate checks; bulk update from a spreadsheet; CSV/Excel export.
- **Investors** (`/investors`): pipeline view of investor-tagged contacts, with "going quiet" tracking.
- **Contact / investor detail**: meeting notes (typed or voice note → transcript), follow-ups with AI suggestions, full WhatsApp chat with replies and media, AI chat summary, AI message drafting, prospect score, portfolio updates with AI analysis.
- **WhatsApp (Meta Cloud API, direct, Coexistence mode)**: inbound webhook with delivery statuses, broadcasts (group/tag/manual targeting, scheduling, per-recipient results, retry failed), templates synced from Meta, unread inbox and unknown numbers, PDF auto-reply to a template button.
- **Dashboard**: KPIs, follow-up trend, tag distribution, upcoming follow-ups.
- **Settings**: daily reminder email, backups (download, stored nightly backups, restore).

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS v4, Base UI (`@base-ui/react`) with shadcn/ui components, Lucide icons, recharts |
| Database | PostgreSQL on the Azure server (`crest_crm`), accessed with `pg` (`lib/db.ts`) |
| Login | NextAuth (credentials), single owner account in `crm_users`; route guard in `proxy.ts` |
| Files | Azure Blob Storage (`lib/storage.ts`), private containers with short-lived signed links |
| AI | Claude (`@anthropic-ai/sdk`, `lib/claude.ts`); Gemini only for voice-note transcription (`lib/gemini.ts`) |
| Email | Brevo, with Resend as fallback (`lib/resend.ts`) |

## Database

The schema is `azure/schema.sql`, then `azure/002_crm_users.sql`, then `azure/003_contact_sections.sql`, applied in that order. `supabase/migrations/` is history from before the move to Azure and is not applied any more.

## Scheduled jobs

A cron job on the server sends `POST` with `Authorization: Bearer <SCHEDULER_SECRET>` to:

- `/api/broadcasts/trigger` every 5 minutes (scheduled broadcasts)
- `/api/follow-ups/trigger` daily at 10:00 IST (reminder email)
- `/api/backup/trigger` daily at 03:00 IST (backup to the `backups` container)

See `azure/SWITCHOVER.md` for the exact crontab. `netlify/` holds the old Netlify scheduled functions, kept only as a fallback until the Netlify site is removed.

## Local development

Prerequisites: Node.js 20+ and npm.

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the values. `azure/SERVER_ENV.md` explains each one. **Note:** a `.env.local` pointing at the server's database works on live data.

```bash
npm run dev
```

Open http://localhost:3000. To set or change the login password, use `azure/set-password.js`.

Before committing:

```bash
npm run lint
npm run build
```

Inbound WhatsApp messages need a public URL, so they only arrive on the live server (or through a tunnel such as ngrok).

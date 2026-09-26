# CREST CRM — HANDOFF / CONTEXT
## Updated: 26 September 2026

You are continuing development of an internal single-user Investor CRM for CREST Capital Management. This document is the source of truth for context — read it fully before suggesting any changes.

IMPORTANT:
- The project is already substantially built. DO NOT rebuild existing functionality.
- Work incrementally, one scoped feature at a time.
- The user (Aditya) is non-technical — he copy-pastes prompts into an AI coding assistant to make changes. He does not write code himself.
- **Never commit or create git branches without asking first.** This was an explicit correction earlier — always leave changes uncommitted on the working tree unless told otherwise.

---

# 1. PROJECT

Project: Investor CRM for CREST Capital Management
Local repository: `D:\CREST\CRM\investor-crm`
GitHub: `https://github.com/crest-capital-management/investor-crm`
Branch: `master`
Supabase project ref: `fyesxkvfgwurejqsobdq`

---

# 2. TECH STACK

- Next.js 16.3.4, App Router, TypeScript, Turbopack
- React 19.2.8
- Supabase Postgres + Auth (free tier) + Storage (new: `whatsapp-media` public bucket)
- shadcn/ui, Tailwind CSS v4, react-day-picker, date-fns
- Meta WhatsApp Cloud API — direct integration (Coexistence mode), NOT AiSensy, NOT Wati
- `recharts` — dashboard analytics charts
- Google Gemini API (`gemini-3.6-flash`) — chat summaries, follow-up suggestions, voice transcription
- Resend — transactional email (new this session, for the daily follow-up reminder)
- Node.js runtime throughout — no Edge runtime anywhere
- `middleware.ts` was renamed to `proxy.ts` (Supabase server client + route protection)

---

# 3. DATABASE SCHEMA (current)

**Active tables:** `contacts`, `groups`, `contact_group_members`, `interactions`, `follow_ups`, `whatsapp_messages`, `broadcasts`, `templates`
**Ignore:** two unused legacy tables `contact_interactions`, `contact_follow_ups`

- `contacts`: id, name, phone, email (optional, app-level required not DB-level), tags (TEXT[]), date_saved, created_at, deleted_at, whatsapp_summary (TEXT, nullable), whatsapp_summary_generated_at (TIMESTAMPTZ, nullable)
- `groups`: id, name, created_at — hard-delete, no deleted_at
- `contact_group_members`: contact_id, group_id, deleted_at (soft-delete, allows reactivation)
- `interactions`: id, contact_id, type ('meeting'), note, created_at, deleted_at — meeting notes and voice-note transcripts both land here as type='meeting'
- `follow_ups`: id, contact_id, due_date, message, is_done, created_at, deleted_at
- `whatsapp_messages`: id, contact_id, direction ('in'/'out'), message_text, media_url, sent_at, created_at, deleted_at — still no wamid/status/error_code columns (known gap, unchanged)
- `broadcasts`, `templates`: broadcast/template persistence

**New this session:** Supabase Storage bucket `whatsapp-media` (public, ~20MB file size limit) — stores a permanent copy of any file sent via WhatsApp media upload/send, since Meta's own media URLs are short-lived and require auth.

Soft-delete pattern: all reads filtered with `.is("deleted_at", null)`. Phone numbers stored as 10-digit Indian local numbers; `+91` prefix added at send-time only via `lib/whatsapp.ts`. RLS is enabled but intentionally permissive (single-user design) — not a bug, don't tighten without it being explicitly requested.

Env var convention: `NEXT_PUBLIC_*` for browser-exposed, plain `SCREAMING_SNAKE_CASE` for server-only secrets.

**Current `.env.local` keys** (values not reproduced here — check the file directly):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
WHATSAPP_ACCESS_TOKEN       <- currently a TEMPORARY token, expires ~1hr, needs manual refresh from Meta's dashboard until the permanent System User token is set up
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
SCHEDULER_SECRET
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
RESEND_API_KEY              <- still BLANK, needs Aditya's Resend account + key
RESEND_FROM_EMAIL            <- still BLANK, needs a verified sender
REMINDER_EMAIL_TO=aditya.dhikale@crest-group.co
WHATSAPP_WEBHOOK_VERIFY_TOKEN  <- set for local ngrok webhook testing
```

---

# 4. WHAT'S BUILT (feature-complete)

Everything from the previous handoff, PLUS this session's additions:

## Built previously (still standing, unchanged)
- Contact management (CRUD, search, soft-delete), CSV import with column mapping/validation
- Investor pipeline (`/investors`) — driven by `lib/tags.ts` (`INVESTOR_TAG`, `isInvestorTag`)
- Full detail pages `/contacts/[id]` and `/investors/[id]`
- Meeting notes and follow-ups (add/edit/delete, overdue indicators, mark-done)
- WhatsApp webhook (`/api/whatsapp/webhook`) — GET verify + POST handling
- Broadcast composer (Group/Tag/Manual targeting, drafts, Send Now, scheduling)
- Template management UI
- Scheduler dispatch function + protected trigger route (`/api/broadcasts/trigger`)
- WhatsApp History component (`components/whatsapp-history.tsx`) — shared by both detail pages
- AI-generated WhatsApp chat summary (Gemini)
- Dashboard: KPIs, greeting banner, analytics (Follow-up Trend, Tag Distribution, Investors Going Quiet)
- 8-tag system (`lib/tags.ts`: Investors, Shareholders, FMS Leads, EO, GRI, Potential Leads, IFA, Distributors) — migration fully complete, DB already on new tags, no SQL migration needed

## Built THIS session (26 Sept 2026)
1. **Daily follow-up email reminder** — `app/follow-ups/actions.ts` (`dispatchDueFollowUpReminders`, `sendTestFollowUpReminder`), `app/api/follow-ups/trigger/route.ts`, `lib/resend.ts`. "Send test reminder email" button on the dashboard. **Not yet on an actual daily schedule** — needs a cron trigger (see §6).
2. **Fixed outbound broadcast logging bug** — `dispatchBroadcast()` in `app/broadcasts/actions.ts` now inserts a `whatsapp_messages` row on every successful send (was a known gap before, silently not logging).
3. **Reply-from-CRM** — `sendWhatsAppReply()` in `app/contacts/actions.ts`. Free-form text reply box in the WhatsApp History Sheet on both contact/investor detail pages. Subject to Meta's 24-hour customer-service window (normal WhatsApp behavior, not a bug).
4. **Media upload/send** — `sendWhatsAppMediaReply()` in `app/contacts/actions.ts`, `uploadWhatsAppMedia`/`sendWhatsAppMediaMessage`/`mimeTypeToWhatsAppMediaType` in `lib/whatsapp.ts`, `uploadWhatsAppMediaToStorage` in `lib/supabase-storage.ts`. Paperclip attach button next to the reply box. Images/documents/video/audio up to 16MB. Confirmed working live with a real photo.
5. **AI-suggested follow-ups** — `suggestFollowUp()` in `app/investors/actions.ts`, `generateFollowUpSuggestion()` in `lib/gemini.ts`. "Suggest with AI" button sits next to the existing manual "Add Follow-up" button (unchanged). Reads WhatsApp history + meeting notes, decides if a follow-up is warranted, pre-fills the existing Add Follow-up dialog for review before saving. Confirmed working live both ways (correctly said "not needed" for content-free messages, correctly drafted a real one from an actionable meeting note).
6. **Voice note → meeting note transcription** — `transcribeVoiceNote()` in `app/contacts/actions.ts`, `transcribeVoiceNoteToMeetingNote()` in `lib/gemini.ts`. "Upload Voice Note" button sits next to the existing manual "Add Meeting Note" button (unchanged). Uploads audio, Gemini transcribes + writes it up as a meeting note draft, pre-fills the existing dialog for review. Audio itself is never stored — only the resulting text. Confirmed working live.
7. **UI redesign: Contact Details quick-view sheet** (`components/contact-details-dialog.tsx`) — collapsed 6 repetitive bordered boxes (Name/Phone/Email/Tags/Groups/Date Saved) into 2 clean cards: a profile card (avatar initials, name, edit icon, phone/email rows with icon-only copy buttons) and an organization card (tags + groups with icon-only "+" add buttons). All existing functionality preserved and verified.
8. **Fixed a real layout bug**: Tag Distribution chart legend on the dashboard — long tag names (e.g. "Potential Leads") were overflowing past the card's edge into the neighboring card due to a missing `min-w-0` on a flex container (classic flexbox truncation trap). Fixed with `min-w-0` + `truncate` + a small safety-minimum width so labels degrade to ellipsis instead of vanishing on very narrow screens.
9. **Reverted heading font** — removed a global CSS rule (`app/globals.css`) that applied Playfair Display to all `h1`, `h2`, and `.font-heading` elements site-wide (this had been done in an earlier session). Now all headings (page titles, Dialog/Sheet titles, sidebar text) use the normal sans body font. The "CREST" logo text (top nav + login page) is untouched — it uses its own separate inline-styled `<span>`, independent of that rule.

---

# 5. WHATSAPP STATUS — READ CAREFULLY (major change from previous handoff)

**Meta Business Verification is RESOLVED.** The account is unlocked. This was previously the single biggest blocker (§6 in the old handoff) — it is no longer blocking anything.

Confirmed working live, with real test sends, this session:
- Outbound broadcast sending (3 test broadcasts sent to a test contact "Aditya Dhikale", phone 7620335644)
- Reply-from-CRM text messages
- Media upload/send (a real photo, confirmed delivered)
- Meta's webhook test tool successfully reached the local dev server via ngrok

**Two things still deliberately deferred (Aditya's choice, not blockers):**
1. **Permanent access token** — currently using a temporary 1-hour token from Meta's Getting Started page. Aditya will set up a permanent System User token once he sorts out payment details on his Meta Business account. Until then, expect to need a fresh temporary token pasted in periodically.
2. **Real inbound messages in local dev** — Meta will not deliver real inbound WhatsApp messages (even from admins/testers) to any webhook until the app is **published**. Confirmed via Meta's own webhook "Test" button (fake payload arrived and logged correctly) vs. a real "hi" message sent from Aditya's phone (never arrived). This is a Meta policy restriction, not a code bug. Aditya chose to leave the app unpublished for now and revisit when closer to actual production rollout with his boss's WhatsApp number.

**Dev/test setup in use:**
- WhatsApp test number: `+1 555-166-0160` (Meta's free sandbox number, `WHATSAPP_PHONE_NUMBER_ID=1359734247222199`)
- Test recipient: Aditya's own number `7620335644`, saved as a CRM contact named "Aditya Dhikale" — this is a placeholder for testing, will be swapped for real investor numbers later
- ngrok tunnel was set up for webhook testing: installed via winget, authenticated with Aditya's free account, tunnel URL was `https://crumb-darling-tabloid.ngrok-free.dev` (this URL **changes every time ngrok restarts** — if picking up webhook work again, a fresh tunnel + updated Meta webhook Callback URL will be needed)
- Production note: Aditya's boss owns the actual production WhatsApp number ("Number X") and must be physically present with his phone for the Coexistence QR-code pairing step when production setup happens — unrelated to but adjacent to the above.

---

# 6. KNOWN LIMITATIONS / GAPS (confirmed, not bugs — do not "fix" without explicit ask)

1. `whatsapp_messages` still has no `wamid`/`status`/`error_code` columns; `broadcasts` has no per-recipient tracking. Webhook receives real `failed` events but can't reconcile them to a broadcast/contact.
2. `sendWhatsAppMessage()`'s reported success only reflects Meta's synchronous API acceptance, not actual delivery — expected Cloud API behavior, not a bug.
3. `supabase/.temp/cli-latest` was accidentally committed a while back — needs `.gitignore` entry + `git rm -r --cached`, not urgent.
4. CSV import does not validate imported tag values against the standard tag list — any string is accepted into `contacts.tags` at import time.
5. Gemini occasionally returns a transient "high demand" / 503 error on any AI call (summary, follow-up suggestion, voice transcription) — not our bug, just retry a few seconds later.
6. No actual daily/periodic cron trigger exists yet for either scheduled broadcasts or the new daily follow-up reminder — both currently require a manual button click or an external trigger call to `/api/broadcasts/trigger` / `/api/follow-ups/trigger` (both protected by `SCHEDULER_SECRET` bearer auth).

---

# 7. ROADMAP STATUS

- ✅ Everything from the previous roadmap (template management, scheduler dispatch, dashboard analytics, WhatsApp History redesign, AI chat summary, tag system migration)
- ✅ Meta Business Verification — resolved, confirmed live
- ✅ Daily follow-up reminder (email via Resend) — built, not yet scheduled
- ✅ Outbound broadcast logging — fixed
- ✅ Reply-from-CRM — built, confirmed live
- ✅ Media upload/send — built, confirmed live
- ✅ AI-suggested follow-ups — built, confirmed live
- ✅ Voice note transcription — built, confirmed live
- ✅ Contact Details dialog UI redesign
- ✅ Tag Distribution chart layout bug — fixed
- ✅ Heading font reverted to normal (Playfair kept only on "CREST" logo)
- ⏳ Actual cron/periodic trigger for scheduled broadcasts and the daily follow-up reminder — deferred until hosting platform is chosen
- ⏳ Inbound webhook messages in local dev / real production rollout — deferred (Meta app publish + permanent token, both Aditya's calls)
- ⏳ RLS tightening — deferred until surface area stabilizes
- ⏳ Google Contacts CSV import — importer likely already compatible, not yet actually tested
- ⏳ `.gitignore` cleanup for `supabase/.temp/`
- 📋 Recently Deleted restore — unscoped, future idea

---

# 8. IMMEDIATE NEXT STEPS (in rough order of readiness)

1. **Get `RESEND_API_KEY` + `RESEND_FROM_EMAIL` from Aditya** to actually enable the daily follow-up reminder email — currently blank in `.env.local`, so the feature is built but can't send yet.
2. **Try the Google Contacts CSV export/import** — no code needed to test, might just work as-is.
3. **`.gitignore` cleanup** for `supabase/.temp/`.
4. When Aditya is ready: **permanent WhatsApp System User token** (needs his Meta payment setup first) and/or **publish the Meta app** (needed for real inbound messages) — both his call, don't push.
5. **Choose a hosting platform** — this unblocks real cron scheduling for both broadcasts and the follow-up reminder.
6. Any further UI/feature polish Aditya wants — not blocked by anything above.

Do NOT start RLS tightening, or Recently Deleted restore without Aditya explicitly raising them. Do NOT commit anything to git without asking first, every time.

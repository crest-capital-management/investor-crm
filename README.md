# CREST Capital Management - Investor CRM

An internal, high-performance Customer Relationship Management (CRM) application built specifically for **CREST Capital Management** to organize, track, and nurture investor relationships, interactions, and follow-ups.

---

## Current Status: Phase 1 (Feature-Complete & Demo-Ready)

Phase 1 development is complete. The system provides an end-to-end foundation for managing contacts, grouping investors, logging interaction notes, scheduling follow-ups, and monitoring key metrics across desktop and mobile devices.

---

## Implemented Features (Phase 1)

### 1. Contact Management
- Full lifecycle management for contacts: create, view, edit, search, and delete.
- Detailed contact profile sheet displaying name, phone number, email, assigned tags, groups, and date saved.
- Quick copy-to-clipboard functionality for phone numbers and email addresses.
- Search and filtering across contacts by name, phone, or email.

### 2. CSV Import
- Dedicated CSV upload modal with drag-and-drop or file browsing.
- Intelligent column mapping for **Name**, **Phone**, **Email** (optional), **Tag**, and **Date Saved**.
- In-browser validation (validates phone digits, email syntax, date format, and required values).
- Data preview table highlighting valid records and actionable validation errors before committing.
- Bulk batch insertion directly into the database.

### 3. Email Support
- First-class support for optional contact email addresses.
- RFC-compliant email format validation on creation, editing, and CSV import.
- Integrated one-click copy button and dedicated email display on contact cards.

### 4. Tags & Custom Groups
- Predefined and custom tags (e.g., `Investor`, `Family Office`, `VC`, `Angel`, `Founder`).
- Dynamic addition of tags directly from the contact details sheet.
- Custom group creation, editing, and deletion.
- Visual member counters and badges across tables and dialogs.

### 5. Bulk Group Management
- Checkbox selection for assigning or removing contacts from groups in bulk.
- "Select All" / indeterminate toggle for visible filtered contacts.
- Group detail sheet with member list search, individual removal, and bulk member removal.

### 6. Investor Tracking (`/investors`)
- Dedicated pipeline view automatically filtering all contacts tagged as `Investor`.
- High-level relationship status, latest logged meeting note, and next scheduled follow-up.
- One-click navigation to detailed investor profiles and direct note/follow-up action modals.

### 7. Investor Details & Interaction / Meeting Notes
- Comprehensive individual profile route (`/investors/[id]`).
- Chronological interaction timeline logging meeting notes, conversation summaries, and timestamps.
- Ability to add, view, and delete meeting records linked to specific investors.

### 8. Follow-up Management
- Schedule follow-up tasks with designated due dates and custom action notes.
- Quick status toggling (pending vs. completed) directly from tables and detail views.
- Dynamic overdue indicators and visual badges highlighting overdue, pending, and completed tasks.

### 9. Dashboard
- Central operational overview displaying four core KPIs:
  - **Total Contacts**
  - **Active Investors**
  - **Pending Follow-ups**
  - **Overdue Follow-ups**
- Quick summary widgets for upcoming follow-ups with instant mark-done actions.
- Recent interaction feed with timestamped meeting logs.

### 10. Authentication & Protected Routes
- Secure email and password authentication powered by Supabase Auth.
- Next.js Edge Middleware protecting private routes (`/dashboard`, `/contacts`, `/groups`, `/investors`, `/my-profile`).
- Automatic redirection of unauthenticated users to `/login`, and authenticated users away from `/login`.
- Server Component session guards (`requireAuth`) and Server Action authorization guards (`requireActionAuth`).
- User profile page (`/my-profile`) displaying account metadata and one-click session logout.

### 11. Dynamic Browser Tab Titles
- Centralized Next.js App Router metadata template (`CREST CRM - %s`).
- Route-specific dynamic page titles that update automatically on navigation:
  - `CREST CRM - Login`
  - `CREST CRM - Dashboard`
  - `CREST CRM - Contacts`
  - `CREST CRM - Groups`
  - `CREST CRM - Investors`
  - `CREST CRM - Investor Details`
  - `CREST CRM - My Profile`

### 12. Responsive Mobile & Tablet Experience
- Fully responsive interface optimized for desktop, tablet, and mobile screens.
- Collapsible navigation drawer (`AppSidebar`) on mobile and tablet viewports.
- Touch-friendly action sheets, adapted button layouts, and horizontal overflow protection across all modals.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16 (App Router)](https://nextjs.org/) |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) |
| **UI Library** | [React 19](https://react.dev/) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) with `@tailwindcss/postcss` |
| **Primitives** | [Base UI (`@base-ui/react`)](https://base-ui.com/) & Shadcn UI pattern |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Database & Auth** | [Supabase](https://supabase.com/) (`@supabase/supabase-js`, `@supabase/ssr`) |
| **Date Utilities** | [date-fns](https://date-fns.org/) & [react-day-picker](https://daypicker.dev/) |
| **Animation / Utils** | `class-variance-authority`, `tw-animate-css`, `cn` |

---

## Project Structure

```
investor-crm/
├── app/                              # Next.js App Router routes & Server Actions
│   ├── contacts/                     # Contacts list view & contact actions
│   ├── dashboard/                    # Executive metrics dashboard
│   ├── groups/                       # Group list view & group actions
│   ├── investors/                    # Investor tracking view & investor actions
│   │   └── [id]/                     # Individual investor details & timeline
│   ├── login/                        # Authentication login page
│   ├── my-profile/                   # User profile & account details
│   ├── globals.css                   # Global styles & Tailwind v4 theme variables
│   ├── layout.tsx                    # Root layout, fonts, providers, metadata template
│   └── page.tsx                      # Root route (redirects to /dashboard)
├── components/                       # Shared UI & feature components
│   ├── ui/                           # Base UI primitives (button, dialog, sheet, input, etc.)
│   ├── add-contact-dialog.tsx        # New contact creation drawer
│   ├── add-group-dialog.tsx          # New group creation dialog
│   ├── app-sidebar.tsx               # Persistent desktop sidebar & mobile drawer
│   ├── contact-details-dialog.tsx    # Contact details & edit sheet
│   ├── contacts-table.tsx            # Interactive contacts data table
│   ├── group-details-dialog.tsx      # Group membership management modal
│   ├── groups-table.tsx              # Groups overview data table
│   ├── import-contacts-dialog.tsx    # CSV upload & column mapping wizard
│   ├── investor-detail.tsx           # Investor profile & interaction timeline
│   ├── investor-tracking-table.tsx   # Investor pipeline data table
│   ├── top-nav.tsx                   # Global header bar & navigation
│   └── toast-provider.tsx            # Global notification toaster
├── lib/                              # Core utilities & server helpers
│   ├── auth.ts                       # Server-side auth verification helpers
│   ├── group-members.ts              # Group relation normalizers
│   └── utils.ts                      # Class-name merger utility (`cn`)
├── middleware.ts                     # Next.js Edge Middleware for route protection
├── src/                              # Supabase client & server initialization
│   ├── app/login/                    # Client-side login component
│   └── lib/supabase/                 # SSR & browser Supabase client factories
├── .env.local                        # Local environment configuration (untracked)
└── package.json                      # Project manifest & dependencies
```

---

## Database Architecture

The application interfaces with a PostgreSQL database hosted on Supabase comprising the following core tables:

### 1. `contacts`
Stores individual contact records.
- `id` (UUID, Primary Key)
- `name` (TEXT, Required)
- `phone` (TEXT, Required)
- `email` (TEXT, Optional)
- `tags` (TEXT[], Array of tag strings)
- `date_saved` (TIMESTAMPTZ, Phonebook save date)
- `created_at` (TIMESTAMPTZ, Creation timestamp)
- `user_id` (UUID, References auth.users)

### 2. `groups`
Stores custom user-defined contact groups.
- `id` (UUID, Primary Key)
- `name` (TEXT, Group title)
- `created_at` (TIMESTAMPTZ)
- `user_id` (UUID, References auth.users)

### 3. `contact_groups`
Junction table managing many-to-many relationships between contacts and groups.
- `contact_id` (UUID, References `contacts.id` on delete cascade)
- `group_id` (UUID, References `groups.id` on delete cascade)

### 4. `interactions`
Logs notes from meetings, phone calls, and conversations.
- `id` (UUID, Primary Key)
- `contact_id` (UUID, References `contacts.id` on delete cascade)
- `type` (TEXT, e.g., `'meeting'`)
- `note` (TEXT, Note contents)
- `created_at` (TIMESTAMPTZ)
- `user_id` (UUID, References auth.users)

### 5. `follow_ups`
Stores scheduled tasks, action items, and follow-ups.
- `id` (UUID, Primary Key)
- `contact_id` (UUID, References `contacts.id` on delete cascade)
- `due_date` (DATE, Scheduled execution date)
- `message` (TEXT, Description of follow-up action)
- `is_done` (BOOLEAN, Completion flag)
- `created_at` (TIMESTAMPTZ)
- `user_id` (UUID, References auth.users)

---

## Authentication & Row-Level Security (RLS)

- **Authentication**: Managed via Supabase Auth using email and password credentials.
- **Session Management**: Cookie-based server sessions via `@supabase/ssr`. Sessions are verified at the Edge layer via `middleware.ts`.
- **Row-Level Security (RLS)**: PostgreSQL RLS policies must be enabled across all tables (`contacts`, `groups`, `contact_groups`, `interactions`, `follow_ups`) ensuring users can only read, insert, update, or delete records where `auth.uid() = user_id`.

---

## Local Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v20 or newer recommended)
- [npm](https://www.npmjs.com/)
- A Supabase project with database migrations applied

### 1. Clone & Install
```bash
git clone <repository-url>
cd investor-crm
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

> **Note:** Never commit `.env.local` or expose production API keys.

### 3. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Code Quality & Validation

Run the following checks before committing code:

```bash
# 1. Run ESLint code quality checks
npm run lint

# 2. Run TypeScript static type check
npx tsc --noEmit

# 3. Verify clean Git formatting (whitespace, EOF, etc.)
git diff --check
```

---

## Future Roadmap (Planned Work)

> **Important:** The following capabilities are planned for subsequent phases and are **not yet implemented** in Phase 1:

- **Official WhatsApp Business API Integration**: Direct WhatsApp messaging capability from within the CRM.
- **WhatsApp Broadcasts**: Send templated updates and announcements to segmented contact groups.
- **Message Scheduling**: Pre-schedule automated follow-up messages and reminders via WhatsApp.
- **WhatsApp Flows**: Interactive structured forms (e.g., investor interest surveys, onboarding questionnaires) completed natively within WhatsApp chats.
- **Voice-First Interaction Logging**: AI-assisted voice note capture that automatically transcribes voice memos into structured meeting notes and scheduled follow-ups.

# Go-live: sign-in code by email (TSK-38 package 7b)

What goes live: signing in has two steps, for **every** account.

1. Email + password (as now). If they are right, the CRM emails a 6-digit
   code to the account's email address (via Brevo, the same sender as the
   reminder email).
2. The code. It works once, for 10 minutes; only the newest code counts
   ("Send a new code" replaces it). 5 wrong codes end the attempt, at most 5
   codes per account per 15 minutes, and wrong codes count towards the login
   lockout (5 wrong in 15 minutes per address).

- Codes are stored only as keyed fingerprints (`login_codes` table,
  migration 006), cleaned up after a day; never in backups.
- If the email can't be sent, signing in stops ("The sign-in code could not
  be emailed"); there is no way round the code.
- Sessions made without a code end at the deploy: **everyone signs in once
  more** (with a code). Sessions also still end on a password change (7a).
- Restoring a backup still asks for the password (not a new code).
- Emergency switch, only if email is down: `EMAIL_CODE_LOGIN_DISABLED=1` in
  the server `.env` + restart = password only. The server warns at start-up
  while it is on. Remove it and restart as soon as email works; the
  password-only sessions then end.

Tested on the local copy (27 Nov 2026) with a throwaway test login (removed):
wrong password refused; right password emails a code (in development the
code goes to the server log because email is off there; never in
production); wrong code counts down "4 tries left" ... then the lockout;
"Send a new code" retires the old one (only one live code, stored as a
fingerprint); right code signs in (API works; nothing extra sent to the
browser); expired code refused; production with no email provider refuses
to sign in and leaves no usable code, and never prints the code; a 7a-style
session (no code) is refused by pages and API; the emergency switch signs in
with the password and warns at start-up, and turning it off ends those
sessions. A database error on the code step shows a plain message, not the
database's.

Who: **A** = Aditya, **S** = Sharath (server).

## Before the deploy

| # | Who | Step | Check |
|---|---|---|---|
| 1 | A | Every login must have a **real mailbox** its owner reads (codes go there). List them: `node azure/delete-user.mjs` shows the logins (just press Ctrl+C at the question). Remove logins nobody uses (e.g. `test@example.com`, which can't receive email). | Each remaining email is a real, read mailbox. |
| 2 | A | Email works on live: My Profile → Send test reminder email. | The email arrives (check spam too). |
| 3 | A | `node azure/run-sql.mjs azure/migrations/006_login_codes.sql` (type `crest_crm`). | "Applied ...006_login_codes.sql." |
| 4 | S | Note the current commit (`git rev-parse HEAD`), the rollback target. | |

## Deploy and check

| # | Who | Step | Check |
|---|---|---|---|
| 1 | S | Deploy `master` as usual. | App starts; no `[security] WARNING` line in the log. |
| 2 | A | Open the CRM, sign in: email + password, then **Continue**. | "We emailed a 6-digit code to a***e@..." |
| 3 | A | Enter the code from the email, **Verify and log in**. | Dashboard opens. |
| 4 | A | Tell the other users: from now on a code is emailed at each sign-in. | |

## If something goes wrong

- Codes don't arrive (Brevo down, sender blocked): S adds
  `EMAIL_CODE_LOGIN_DISABLED=1` to the server `.env` and restarts (password
  only, temporarily). Remove it once email works.
- Anything else: S deploys the commit from "Before the deploy" step 4. The
  `login_codes` table can stay.

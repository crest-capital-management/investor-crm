# Go-live: session hardening (TSK-38 package 7a)

What goes live (no database change, no new setting):

1. **Sessions end when a password changes.** A session records which password
   it signed in with (`crm_users.password_updated_at`). Changing a password
   (`node azure/set-password.mjs`) or removing a login ends every open session
   of that account, within about 10 seconds (`lib/session.ts`).
2. **API routes are checked in one place.** `proxy.ts` refuses any API call
   without a current session (401), before the route runs; each route still
   checks again itself. Open by design, because they check their own secret:
   NextAuth (`/api/auth/...`), the WhatsApp webhook (Meta signature) and the
   three scheduled jobs (`SCHEDULER_SECRET`).
3. **Restoring a backup asks for the password again** (on top of typing
   RESTORE). Wrong passwords count towards the login lockout (5 in 15 minutes).
4. **Change password on My Profile** (Security & Session → Change password):
   current password, new one twice (at least 12 characters, different from
   the current one). Afterwards every session of the account ends, this one
   too, and the user signs in again with the new password. Wrong current
   passwords count towards the lockout. `azure/set-password.mjs` still works
   for new logins and resets.

**Everyone signs in once more after the deploy:** sessions made before it
don't record a password version, so they are ended on the first visit (the
browser is sent to the login page and the old cookie is removed).

Tested on the local copy with a production build (27 Nov 2026), using a
throwaway test login (removed afterwards): an old-style session is refused by
pages and API and its cookie cleared (no redirect loop); a real sign-in works
(pages, API, exports), a wrong password is refused; the restore button stays
disabled without a password, a wrong password is refused with nothing changed,
the right one restores (safety copy taken first); changing the password ends
the open session at once (API 401, pages to login, cookie cleared) and a new
sign-in works; unknown API routes give 401 when signed out; the webhook and
scheduled jobs still reach their own checks (the backup job ran with the real
secret); the Content-Security-Policy from package 6 is unchanged. Change
password: a wrong current password and mismatched new ones are refused; the
real change signs out this browser and a second signed-in session at once,
the old password stops working and the new one signs in.

Who: **A** = Aditya, **S** = Sharath (server).

## Deploy and check

| # | Who | Step | Check |
|---|---|---|---|
| 1 | S | Write down the current commit (`git rev-parse HEAD`), then deploy `master` as usual. | App starts as before. |
| 2 | A | Open the CRM. | You are sent to the login page once; sign in. |
| 3 | A | Click through a few pages; open a contact's chat (it refreshes every few seconds). | All as before. |
| 4 | S | The scheduled jobs: next 5-minute broadcast run / 03:00 backup still succeed (cron log). | No 401 errors. |
| 5 | A | Optional: My Profile → Restore… → pick a backup → Check backup: the password box is there. **Cancel**, don't restore. | |
| 6 | A | Optional: My Profile → Change password, change yours (you are signed out), sign in with the new one. | Works; keep the new password safe. |

Tell the other CRM users they will need to sign in again once.

## If something goes wrong

S deploys the commit from step 1 (nothing in the database changed).

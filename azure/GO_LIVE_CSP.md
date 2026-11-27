# Go-live: Content-Security-Policy (TSK-38 package 6)

What goes live: every page is sent with a `Content-Security-Policy` header
(`lib/csp.ts`, set in `proxy.ts`). The browser then runs only scripts that
carry that response's random nonce (Next.js adds it to its own scripts; the
theme script in `app/layout.tsx` gets it too), and only talks to this site.
An injected `<script>`, an `onerror=`/`onclick=` handler, a `javascript:` link,
a script from another site, or sending data to another site is blocked.

- Images, voice notes and videos in chats load from the Azure storage account
  (the media route redirects there); that one storage address is allowed. It
  is read from `AZURE_STORAGE_CONNECTION_STRING`, nothing to configure.
- Every page now renders per request (the nonce needs it; `/login` and
  `/privacy-policy` were pre-built before). No visible change.
- API routes get no policy (they return data, not pages).
- No database change, no new required setting.

Tested on the local copy with a production build (27 Nov 2026): all 20
scripts of a page carry the nonce, a new nonce per request; login, dashboard,
contacts (list, search, contact page), investors, groups, follow-ups,
broadcasts (list, new, detail, row menu), templates (list, detail, new),
unread messages, My Profile (dark mode, Back up now, Restore dialog and its
dropdown), privacy policy and the 404 page load with no blocked content;
dark mode is applied on a fresh load (theme script runs); a chat photo loads
through the storage redirect; sign-in and sign-out work. Injected markup
(inline script, script from another site, `onerror=`, `javascript:` link) and
a fetch to another site are blocked. Base UI's scrollbar `<style>` gets the
nonce through `CSPProvider`. `CSP_REPORT_ONLY=1` switches to report-only.
Development (`npm run dev`) allows inline styles and `eval` for Next.js's dev
tools, as the Next.js guide says; production does not.

Who: **A** = Aditya, **S** = Sharath (server).

## Before the deploy

| # | Who | Step |
|---|---|---|
| 1 | S | Check nginx does **not** add its own `Content-Security-Policy` header (two policies would both apply). `grep -ri content-security /etc/nginx/` should find nothing for this site. |
| 2 | S | Write down the commit the server runs now (`git rev-parse HEAD`): the rollback target. |

## Deploy and check

| # | Who | Step | Check |
|---|---|---|---|
| 1 | S | Deploy `master` as usual (pull, `npm ci`, `npm run build`, restart). | App starts as before. |
| 2 | S | `curl -sI https://investor-crm.crest-capital.com/login \| grep -i content-security` | One `content-security-policy:` line with `'nonce-...'` and the `...blob.core.windows.net` address. |
| 3 | A | Hard-refresh (Ctrl+Shift+R) and click through: dashboard, contacts (search, a contact page with a WhatsApp photo or voice note), investors, broadcasts (new, a row menu), templates, unread messages, My Profile (dark mode on and off, Restore... then Cancel), log out and in. | Everything looks and works as before; chat photos show. |
| 4 | A | Optional, to be sure: press F12, open the **Console** tab, reload a page. | No red lines mentioning "Content Security Policy". |

## If something breaks

1. Quick fallback, no redeploy: S adds `CSP_REPORT_ONLY=1` to the server
   `.env` and restarts. The policy is then only reported (in the browser
   console), nothing is blocked. Send the console lines (F12 → Console) so the
   policy can be fixed, then remove the setting again.
2. Full rollback: S deploys the commit from "Before the deploy" step 2.

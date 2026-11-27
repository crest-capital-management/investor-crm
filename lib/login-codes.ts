import crypto from "node:crypto";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/resend";
export { EMAIL_CODE_AMR, emailCodeLoginDisabled } from "@/lib/login-mode";

/**
 * Two-step sign-in by emailed code (TSK-38 package 7b), required for every
 * account. After the right password, a 6-digit code is emailed to the
 * account's address; the browser gets a random token for this attempt and
 * signs in with token + code (lib/auth-options.ts).
 *
 * - Stored: keyed fingerprints only (HMAC with NEXTAUTH_SECRET) of the token
 *   and of token+code, so a copy of the database reveals no usable code.
 * - A code works once, for CODE_TTL_MS, and only the newest one per account
 *   counts. MAX_ATTEMPTS wrong codes end the attempt; MAX_CODES_PER_WINDOW
 *   codes per account per 15 minutes.
 * - If the email can't be sent, sign-in stops (no way around the code).
 *   In development without an email provider the code is printed in the
 *   server log instead, so local testing works; never in production.
 * - EMAIL_CODE_LOGIN_DISABLED=1 in the server .env turns the code step off
 *   (emergency only, e.g. the email provider is down): sign-in is password
 *   only again. Logged loudly. See azure/GO_LIVE_EMAIL_LOGIN_CODE.md.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is not set.");
  return value;
}

function fingerprint(purpose: string, value: string): string {
  return crypto.createHmac("sha256", secret()).update(`${purpose}\u0000${value}`).digest("hex");
}

/** "rahul@example.com" -> "r***l@example.com", for "we sent a code to ...". */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "your email";
  const shown = name.length <= 2 ? `${name[0] ?? ""}*` : `${name[0]}***${name[name.length - 1]}`;
  return `${shown}@${domain}`;
}

function codeEmailHtml(code: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">
  <p>Your CREST CRM sign-in code is:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
  <p>It works once and expires in 10 minutes.</p>
  <p style="color:#555">If you did not just try to sign in, someone may know your password: change it on My Profile, or ask the CRM administrator to reset it.</p>
</div>`;
}

export type StartResult = { token: string } | { error: string };

/**
 * Creates a code for a user whose password was just checked, emails it and
 * returns the token the browser needs for step 2. Earlier unused codes of the
 * account stop working.
 */
export async function createAndSendLoginCode(user: { id: string; email: string }): Promise<StartResult> {
  // Housekeeping: codes older than a day are of no use.
  await db.execute("delete from public.login_codes where created_at < now() - interval '1 day'").catch(() => undefined);

  const recent = await db.one<{ n: number }>(
    "select count(*)::int as n from public.login_codes where user_id = $1 and created_at > $2",
    [user.id, new Date(Date.now() - WINDOW_MS).toISOString()],
  );
  if (recent.n >= MAX_CODES_PER_WINDOW) {
    return { error: "Too many codes were requested. Please wait 15 minutes and try again." };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const tokenHash = fingerprint("login token", token);

  await db.tx(async (tx) => {
    await tx.execute("update public.login_codes set used_at = now() where user_id = $1 and used_at is null", [user.id]);
    await tx.execute(
      `insert into public.login_codes (token_hash, user_id, code_hash, expires_at)
       values ($1, $2, $3, $4)`,
      [tokenHash, user.id, fingerprint("login code", `${token}:${code}`), new Date(Date.now() + CODE_TTL_MS).toISOString()],
    );
  });

  const noEmailProvider = !process.env.BREVO_API_KEY && !process.env.RESEND_API_KEY;
  if (process.env.NODE_ENV === "development" && noEmailProvider) {
    console.info(`[login code] development only, no email provider: code for ${user.email} is ${code}`);
    return { token };
  }

  try {
    await sendEmail({ to: user.email, subject: `CREST CRM sign-in code: ${code}`, html: codeEmailHtml(code) });
  } catch (err) {
    console.error("[login code] could not email the code:", err instanceof Error ? err.message : err);
    await db.execute("delete from public.login_codes where token_hash = $1", [tokenHash]).catch(() => undefined);
    return { error: "The sign-in code could not be emailed. Please try again in a few minutes." };
  }
  return { token };
}

export type CheckResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; userId?: string };

/**
 * Checks token + code from step 2. Right: the code is used up and the user's
 * id returned. Wrong: one attempt is counted (MAX_ATTEMPTS ends the attempt).
 */
export async function checkLoginCode(token: string, code: string): Promise<CheckResult> {
  const startAgain = "This code has expired or was replaced. Please sign in again.";
  if (!token || !/^\d{6}$/.test(code.trim())) {
    return { ok: false, error: "Enter the 6-digit code from the email." };
  }

  const tokenHash = fingerprint("login token", token);
  return db.tx(async (tx) => {
    const row = await tx.maybeOne<{ user_id: string; code_hash: string; attempts: number; expires_at: string }>(
      `select user_id, code_hash, attempts, expires_at
         from public.login_codes
        where token_hash = $1 and used_at is null
        for update`,
      [tokenHash],
    );
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: startAgain };

    const expected = Buffer.from(row.code_hash, "hex");
    const given = Buffer.from(fingerprint("login code", `${token}:${code.trim()}`), "hex");
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) {
      await tx.execute("update public.login_codes set used_at = now() where token_hash = $1", [tokenHash]);
      return { ok: true, userId: row.user_id };
    }

    const attempts = row.attempts + 1;
    await tx.execute(
      `update public.login_codes
          set attempts = $2::int, used_at = case when $2::int >= $3::int then now() else null end
        where token_hash = $1`,
      [tokenHash, attempts, MAX_ATTEMPTS],
    );
    return {
      ok: false,
      userId: row.user_id,
      error:
        attempts >= MAX_ATTEMPTS
          ? "Too many wrong codes. Please sign in again to get a new code."
          : `That code is not right (${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"} left).`,
    };
  });
}

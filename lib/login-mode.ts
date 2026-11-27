/**
 * How signing in works (TSK-38 package 7b), in a file of its own so proxy.ts
 * and lib/session.ts can read it without loading the email code.
 */

/** The session claim that says the sign-in used an emailed code. */
export const EMAIL_CODE_AMR = "email-code";

/**
 * EMAIL_CODE_LOGIN_DISABLED=1 in the server .env turns the emailed code off
 * (emergency only, e.g. the email provider is down): signing in is password
 * only, and password-only sessions count. See azure/GO_LIVE_EMAIL_LOGIN_CODE.md.
 */
export function emailCodeLoginDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EMAIL_CODE_LOGIN_DISABLED === "1";
}

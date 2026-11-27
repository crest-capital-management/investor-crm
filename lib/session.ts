import { db } from "@/lib/db";
import { EMAIL_CODE_AMR, emailCodeLoginDisabled } from "@/lib/login-mode";

/**
 * Is a signed session still valid? (TSK-38 package 7a.)
 *
 * The session cookie is signed and lasts 7 days, so on its own it would stay
 * valid after the account's password is changed or the account is removed. At
 * sign-in the session records the account's password_updated_at
 * (lib/auth-options.ts, as `pv`); a session is current only while the account
 * still exists and that value is unchanged. azure/set-password.mjs sets
 * password_updated_at, so changing a password ends every open session of that
 * account. The stored value is compared as it is (not against a clock), so
 * clock differences between servers don't matter.
 *
 * Sessions from before this check carry no `pv` and are treated as ended: each
 * user signs in once more after the deploy.
 *
 * Used by proxy.ts (pages and API routes) and lib/auth.ts (pages, actions,
 * API routes), so both layers agree.
 */

// Lookups are cached briefly: the chat polls every few seconds. A password
// changed from another process (the script) ends sessions within this time.
const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; passwordUpdatedAt: string | null }>();

/** The account's password_updated_at as the app reads it (ISO text), or null if there is no such account. */
async function currentPasswordVersion(userId: string): Promise<string | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.passwordUpdatedAt;
  const row = await db.maybeOne<{ password_updated_at: string }>(
    "select password_updated_at from public.crm_users where id = $1",
    [userId],
  );
  const passwordUpdatedAt = row?.password_updated_at ?? null;
  cache.set(userId, { at: Date.now(), passwordUpdatedAt });
  if (cache.size > 1000) cache.clear();
  return passwordUpdatedAt;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True if the session's user still exists, their password is unchanged since
 * this session signed in, and it signed in with an emailed code (package 7b;
 * password-only sessions count only while EMAIL_CODE_LOGIN_DISABLED=1).
 */
export async function isSessionCurrent(userId: unknown, passwordVersion: unknown, amr: unknown): Promise<boolean> {
  if (typeof userId !== "string" || !UUID.test(userId)) return false;
  if (typeof passwordVersion !== "string" || !passwordVersion) return false;
  if (amr !== EMAIL_CODE_AMR && !emailCodeLoginDisabled()) return false;
  try {
    return (await currentPasswordVersion(userId)) === passwordVersion;
  } catch (err) {
    // A database problem must not let a session through unchecked.
    console.error("[session] could not check the session:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Forgets the cached lookup for an account, after this server changed its password. */
export function forgetSessionCache(userId: string): void {
  cache.delete(userId);
}

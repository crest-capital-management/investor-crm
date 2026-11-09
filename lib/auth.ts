import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/lib/db";

/**
 * The CRM has a single owner. Row-level security used to enforce that inside
 * the database (public.is_crm_owner()); the app now talks to PostgreSQL
 * directly, which bypasses those rules, so every guard below checks the signed-in
 * user's id against CRM_OWNER_ID itself. A missing setting denies everyone.
 */
export function isOwnerId(userId: string | null | undefined): boolean {
  const ownerId = process.env.CRM_OWNER_ID?.trim().toLowerCase();
  if (!ownerId) {
    console.error("[auth] CRM_OWNER_ID is not set, so nobody can be treated as the owner.");
    return false;
  }
  return Boolean(userId) && userId!.toLowerCase() === ownerId;
}

export type CrmUser = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_login_at: string | null;
};

/**
 * The signed-in owner's id, or null. The session is a signed cookie checked on
 * this server (no database or network call), so it is cheap enough for API
 * routes that are polled every few seconds.
 */
export async function getOwnerSessionId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  return id && isOwnerId(id) ? id : null;
}

/**
 * Ensures the owner is signed in for Server Components (pages) and returns
 * their account. If not, immediately redirects to /login.
 */
export async function requireAuth() {
  const id = await getOwnerSessionId();
  const user = id
    ? await db.maybeOne<CrmUser>(
        "select id, email, name, created_at, last_login_at from public.crm_users where id = $1",
        [id],
      )
    : null;
  if (!user) redirect("/login");

  return { db, user };
}

/**
 * Faster version of requireAuth for pages that only need the database: it
 * checks the session cookie but does not load the account.
 */
export async function requireAuthFast() {
  if (!(await getOwnerSessionId())) redirect("/login");

  return { db };
}

/**
 * Ensures the caller is the signed-in owner for Server Actions.
 * If not, returns an Unauthorized error response instead of redirecting.
 */
export async function requireActionAuth() {
  const id = await getOwnerSessionId();
  if (!id) return { db: null, userId: null, error: "Unauthorized" as const };

  return { db, userId: id, error: null };
}

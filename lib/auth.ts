import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createClient } from "@/src/lib/supabase/server";

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

/**
 * Ensures the user is authenticated for Server Components (pages).
 * If unauthenticated, immediately redirects to /login.
 */
export async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !isOwnerId(user.id)) {
    redirect("/login");
  }

  return { supabase, db, user };
}

/**
 * Faster version of requireAuth for pages that only need the database.
 * It checks the signed-in session on the server itself (the token's signature
 * and expiry) instead of asking the Supabase auth service over the network on
 * every page load, which saves a round trip per request. Pages that show
 * account details use requireAuth instead.
 */
export async function requireAuthFast() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims || !isOwnerId(data.claims.sub)) {
    redirect("/login");
  }

  return { supabase, db };
}

/**
 * Same as requireActionAuth. Kept for the actions that used to need an extra
 * owner check; requireActionAuth now confirms the owner for every action.
 */
export async function requireOwnerAction() {
  return requireActionAuth();
}

/**
 * Ensures the caller is the signed-in owner for Server Actions.
 * If not, returns an Unauthorized error response instead of redirecting.
 */
export async function requireActionAuth() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !isOwnerId(user.id)) {
    return { supabase: null, db: null, user: null, error: "Unauthorized" as const };
  }

  return { supabase, db, user, error: null };
}

import { redirect } from "next/navigation";
import { createClient } from "@/src/lib/supabase/server";

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

  if (error || !user) {
    redirect("/login");
  }

  return { supabase, user };
}

/**
 * Ensures the caller is authenticated for Server Actions.
 * If unauthenticated, returns an Unauthorized error response instead of redirecting.
 */
export async function requireActionAuth() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase: null, user: null, error: "Unauthorized" as const };
  }

  return { supabase, user, error: null };
}

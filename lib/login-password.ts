import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/lib/login-rate-limit";

// Hash of a random throwaway string. Compared against when the email is unknown,
// so a wrong email takes as long as a wrong password.
const DUMMY_HASH = "$2b$12$yGBBTVx.IHyVQaxEwVLgq.w/cYV7N54L1CeQo9y0cW.OXBCH2YAtK";

export type LoginUser = { id: string; email: string; name: string | null; password_updated_at: string };

/**
 * Step 1 of signing in: checks email + password, with the lockout (5 wrong in
 * 15 minutes per address). Returns the account, or an error to show. The same
 * message for an unknown email and a wrong password.
 */
export async function checkLoginPassword(
  emailInput: string,
  password: string,
  ip: string | null,
): Promise<{ user: LoginUser } | { error: string }> {
  const email = emailInput.trim().toLowerCase();
  if (!email || !password) return { error: "Invalid email or password." };
  if (isLoginBlocked(email, ip)) return { error: "Too many attempts. Please wait 15 minutes and try again." };

  const user = await db.maybeOne<LoginUser & { password_hash: string }>(
    "select id, email, name, password_hash, password_updated_at from public.crm_users where email = $1",
    [email],
  );
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordLoginFailure(email, ip);
    return { error: "Invalid email or password." };
  }
  clearLoginFailures(email, ip);
  return { user: { id: user.id, email: user.email, name: user.name, password_updated_at: user.password_updated_at } };
}

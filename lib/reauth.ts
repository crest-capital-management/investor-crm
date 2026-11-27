import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  clearLoginFailures,
  clientIpFromForwardedFor,
  isLoginBlocked,
  recordLoginFailure,
} from "@/lib/login-rate-limit";

/**
 * Asks the signed-in user for their password again before a dangerous step
 * (restoring a backup; TSK-38 package 7a), so an unattended open session or a
 * stolen cookie isn't enough. Wrong passwords count towards the same lockout
 * as the login page (5 in 15 minutes per address).
 * Returns null when the password is right, otherwise a message to show.
 */
export async function confirmPassword(userId: string, password: string): Promise<string | null> {
  if (!password) return "Enter your password to confirm.";

  const user = await db.maybeOne<{ email: string; password_hash: string }>(
    "select email, password_hash from public.crm_users where id = $1",
    [userId],
  );
  if (!user) return "Your account could not be found. Please sign in again.";

  const ip = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  if (isLoginBlocked(user.email, ip)) return "Too many attempts. Please wait 15 minutes and try again.";

  if (!(await bcrypt.compare(password, user.password_hash))) {
    recordLoginFailure(user.email, ip);
    return "That password is not right.";
  }
  clearLoginFailures(user.email, ip);
  return null;
}

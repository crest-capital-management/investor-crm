"use server";

import bcrypt from "bcryptjs";
import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { confirmPassword } from "@/lib/reauth";
import { forgetSessionCache } from "@/lib/session";

/** Same rule as azure/set-password.mjs. */
const MIN_PASSWORD_LENGTH = 12;
// bcrypt only uses the first 72 bytes; a longer password would silently match its first 72.
const MAX_PASSWORD_BYTES = 72;

/**
 * Changes the signed-in user's own password (My Profile). Needs the current
 * password (wrong ones count towards the login lockout). Every session of the
 * account ends, this one included (lib/session.ts), so the user signs in again
 * with the new password.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
  repeatPassword: string,
): Promise<{ success?: true; error?: string }> {
  const { error: authError, userId } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (Buffer.byteLength(newPassword, "utf8") > MAX_PASSWORD_BYTES) {
    return { error: "The new password is too long (at most 72 characters)." };
  }
  if (newPassword !== repeatPassword) return { error: "The two new passwords are not the same." };
  if (newPassword === currentPassword) return { error: "The new password must be different from the current one." };

  const problem = await confirmPassword(userId, currentPassword);
  if (problem) return { error: problem === "That password is not right." ? "Your current password is not right." : problem };

  try {
    const hash = await bcrypt.hash(newPassword, 12);
    await db.execute("update public.crm_users set password_hash = $2, password_updated_at = now() where id = $1", [
      userId,
      hash,
    ]);
  } catch (err) {
    console.error("[password] could not change the password:", err instanceof Error ? err.message : err);
    return { error: "The password could not be changed. Please try again." };
  }
  // End this account's sessions on this server at once (not after the cache time).
  forgetSessionCache(userId);
  return { success: true };
}

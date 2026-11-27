"use server";

import { headers } from "next/headers";
import { checkLoginPassword } from "@/lib/login-password";
import { clientIpFromForwardedFor } from "@/lib/login-rate-limit";
import { createAndSendLoginCode, emailCodeLoginDisabled, maskEmail } from "@/lib/login-codes";

export type StartLoginResult =
  /** Code emailed: the form asks for it and signs in with this token. */
  | { step: "code"; token: string; sentTo: string }
  /** Emergency switch on (EMAIL_CODE_LOGIN_DISABLED=1): sign in with the password alone. */
  | { step: "password-only" }
  | { error: string };

/**
 * Step 1 of signing in (TSK-38 package 7b): checks the password and emails a
 * one-time code to the account's address. No session is made here; step 2 is
 * signIn("credentials", { token, code }) (lib/auth-options.ts).
 */
export async function startLogin(email: string, password: string): Promise<StartLoginResult> {
  const ip = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const checked = await checkLoginPassword(String(email ?? ""), String(password ?? ""), ip);
  if ("error" in checked) return { error: checked.error };

  if (emailCodeLoginDisabled()) return { step: "password-only" };

  try {
    const sent = await createAndSendLoginCode(checked.user);
    if ("error" in sent) return { error: sent.error };
    return { step: "code", token: sent.token, sentTo: maskEmail(checked.user.email) };
  } catch (err) {
    console.error("[login] could not start the code step:", err instanceof Error ? err.message : err);
    return { error: "Signing in is not possible right now. Please try again in a few minutes." };
  }
}

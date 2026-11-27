import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { checkLoginCode, EMAIL_CODE_AMR, emailCodeLoginDisabled } from "@/lib/login-codes";
import { checkLoginPassword } from "@/lib/login-password";
import { clientIpFromForwardedFor, isLoginBlocked, recordLoginFailure } from "@/lib/login-rate-limit";

/** Sessions last a week, then the owner signs in again. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type UserRow = { id: string; email: string; name: string | null; password_updated_at: string };

function clientIp(headers: Record<string, unknown> | undefined): string | null {
  const forwarded = headers?.["x-forwarded-for"];
  return clientIpFromForwardedFor(typeof forwarded === "string" ? forwarded : null);
}

/**
 * Signing in has two steps (TSK-38 package 7b): app/login/actions.ts
 * startLogin checks the password and emails a one-time code; then the form
 * signs in here with the token from step 1 and the code (lib/login-codes.ts).
 * Email + password alone are accepted only while the emergency switch
 * EMAIL_CODE_LOGIN_DISABLED=1 is on.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email code",
      credentials: {
        token: { label: "Token", type: "text" },
        code: { label: "Code", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const ip = clientIp(req?.headers);
        let user: UserRow | null = null;
        let amr: string;

        if (credentials?.token) {
          // Step 2: the code from the email.
          let result: Awaited<ReturnType<typeof checkLoginCode>>;
          try {
            result = await checkLoginCode(credentials.token, credentials.code ?? "");
          } catch (err) {
            // Never show a database message on the login page.
            console.error("[login] could not check the code:", err instanceof Error ? err.message : err);
            throw new Error("Signing in is not possible right now. Please try again in a few minutes.");
          }
          const account = result.userId
            ? await db.maybeOne<UserRow>(
                "select id, email, name, password_updated_at from public.crm_users where id = $1",
                [result.userId],
              )
            : null;
          if (account && isLoginBlocked(account.email, ip)) {
            throw new Error("Too many attempts. Please wait 15 minutes and try again.");
          }
          if (!result.ok) {
            if (account) recordLoginFailure(account.email, ip);
            throw new Error(result.error);
          }
          user = account;
          amr = EMAIL_CODE_AMR;
        } else if (emailCodeLoginDisabled()) {
          // Emergency switch on: the password alone.
          const checked = await checkLoginPassword(credentials?.email ?? "", credentials?.password ?? "", ip);
          if ("error" in checked) throw new Error(checked.error);
          user = checked.user;
          amr = "password";
        } else {
          return null;
        }

        if (!user) return null;
        await db.execute("update public.crm_users set last_login_at = now() where id = $1", [user.id]);
        return { id: user.id, email: user.email, name: user.name, passwordVersion: user.password_updated_at, amr };
      },
    }),
  ],
  callbacks: {
    // The session records which password it was made with (a password change
    // ends it) and how the user signed in (password-only sessions are refused
    // while the code step is on). lib/session.ts isSessionCurrent.
    async jwt({ token, user }) {
      if (user) {
        token.pv = user.passwordVersion;
        token.amr = user.amr;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.sub ?? "";
      return session;
    },
  },
};

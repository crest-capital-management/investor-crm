import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import {
  clearLoginFailures,
  clientIpFromForwardedFor,
  isLoginBlocked,
  recordLoginFailure,
} from "@/lib/login-rate-limit";

/** Sessions last a week, then the owner signs in again. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// Hash of a random throwaway string. Compared against when the email is unknown,
// so a wrong email takes as long as a wrong password.
const DUMMY_HASH = "$2b$12$yGBBTVx.IHyVQaxEwVLgq.w/cYV7N54L1CeQo9y0cW.OXBCH2YAtK";

type UserRow = { id: string; email: string; name: string | null; password_hash: string; password_updated_at: string };

function clientIp(headers: Record<string, unknown> | undefined): string | null {
  const forwarded = headers?.["x-forwarded-for"];
  return clientIpFromForwardedFor(typeof forwarded === "string" ? forwarded : null);
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase() ?? "";
        const password = credentials?.password ?? "";
        if (!email || !password) return null;

        const ip = clientIp(req?.headers);
        if (isLoginBlocked(email, ip)) {
          throw new Error("Too many attempts. Please wait 15 minutes and try again.");
        }

        const user = await db.maybeOne<UserRow>(
          "select id, email, name, password_hash, password_updated_at from public.crm_users where email = $1",
          [email],
        );
        const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !ok) {
          recordLoginFailure(email, ip);
          return null;
        }

        clearLoginFailures(email, ip);
        await db.execute("update public.crm_users set last_login_at = now() where id = $1", [user.id]);
        return { id: user.id, email: user.email, name: user.name, passwordVersion: user.password_updated_at };
      },
    }),
  ],
  callbacks: {
    // At sign-in the session records which password it was made with, so a
    // password change ends it (lib/session.ts isSessionCurrent).
    async jwt({ token, user }) {
      if (user) token.pv = user.passwordVersion;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.sub ?? "";
      return session;
    },
  },
};

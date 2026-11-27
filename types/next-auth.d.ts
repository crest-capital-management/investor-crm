import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
  }
  interface User {
    /** crm_users.password_updated_at at sign-in (lib/session.ts). */
    passwordVersion?: string;
    /** How the user signed in: "email-code", or "password" with the emergency switch (lib/login-codes.ts). */
    amr?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** The password version the session signed in with (lib/session.ts). */
    pv?: string;
    /** How the session signed in (lib/login-codes.ts EMAIL_CODE_AMR). */
    amr?: string;
  }
}

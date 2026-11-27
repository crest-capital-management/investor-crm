/**
 * Startup check of the settings the app cannot run safely without.
 * Called once from instrumentation.ts. In production a problem stops the
 * server from starting; in development it is only logged.
 */

const MIN_SECRET_LENGTH = 32;

function problems(env: NodeJS.ProcessEnv): string[] {
  const found: string[] = [];
  const missing = (name: string) => !env[name]?.trim();

  if (missing("AZURE_CONNECTION_STRING") && missing("DATABASE_URL")) {
    found.push("AZURE_CONNECTION_STRING is not set.");
  }

  const authSecret = env.NEXTAUTH_SECRET?.trim() ?? "";
  if (!authSecret) {
    found.push("NEXTAUTH_SECRET is not set.");
  } else if (authSecret.length < MIN_SECRET_LENGTH) {
    found.push(`NEXTAUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }

  const schedulerSecret = env.SCHEDULER_SECRET?.trim() ?? "";
  if (!schedulerSecret) {
    found.push("SCHEDULER_SECRET is not set.");
  } else if (schedulerSecret.length < 16) {
    found.push("SCHEDULER_SECRET must be at least 16 characters.");
  }

  if (missing("META_APP_SECRET") && missing("WHATSAPP_APP_SECRET")) {
    found.push("META_APP_SECRET is not set (needed to check webhook signatures).");
  }

  if (missing("WHATSAPP_WEBHOOK_VERIFY_TOKEN")) {
    found.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set.");
  }

  return found;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.EMAIL_CODE_LOGIN_DISABLED === "1") {
    console.warn(
      "[security] WARNING: EMAIL_CODE_LOGIN_DISABLED=1, signing in needs only the password (no emailed code). " +
        "Emergency use only: remove it from .env and restart as soon as email works again.",
    );
  }
  const found = problems(env);
  if (found.length === 0) return;

  const message = `Configuration problems:\n- ${found.join("\n- ")}`;
  if (env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`[env] ${message}`);
}

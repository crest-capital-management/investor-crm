import { db } from "@/lib/db";
import { setKeyring } from "@/lib/encryption";
import { loadKeyring, verifyKeyFingerprints } from "@/lib/keys";

/**
 * Loads the encryption keys once at server start (from instrumentation.ts)
 * and checks them against the database before any request is handled.
 * Missing, wrong or unregistered keys stop the server: personal data is
 * written encrypted, so the app can't work without them.
 */
export async function initEncryption(): Promise<void> {
  const keyring = await loadKeyring();
  if (!keyring) {
    setKeyring(null);
    throw new Error(
      "No encryption key configured. Set PII_ENCRYPTION_SECRET_KEY (see azure/ENCRYPTION_KEYS.md).",
    );
  }

  try {
    await verifyKeyFingerprints(keyring, async (sql, params) => ({ rows: await db.query(sql, params) }));
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "42P01") {
      throw new Error("Table encryption_keys is missing. Apply azure/migrations/001_encryption.sql first.");
    }
    throw error;
  }

  setKeyring(keyring);
  console.info(`[encryption] Keys loaded and verified (current key "${keyring.currentKeyId}").`);
}

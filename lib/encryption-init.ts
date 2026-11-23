import { db } from "@/lib/db";
import { setKeyring } from "@/lib/encryption";
import { loadKeyring, verifyKeyFingerprints } from "@/lib/keys";

/**
 * Loads the encryption keys once at server start (from instrumentation.ts)
 * and checks them against the database before any request is handled.
 * Wrong or unregistered keys stop the server; no keys configured only warns
 * for now (nothing is encrypted yet) and becomes required once data is.
 */
export async function initEncryption(): Promise<void> {
  const keyring = await loadKeyring();
  if (!keyring) {
    setKeyring(null);
    console.warn("[encryption] No encryption key configured (PII_ENCRYPTION_SECRET_KEY). Encrypted fields cannot be read or written.");
    return;
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

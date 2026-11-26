import { db } from "@/lib/db";
import { setKeyring } from "@/lib/encryption";
import { setBackupKeyring } from "@/lib/backup-encryption";
import { loadBackupKeyring, loadKeyring, verifyBackupKeyFingerprints, verifyKeyFingerprints } from "@/lib/keys";

/**
 * Loads the encryption keys once at server start (from instrumentation.ts)
 * and checks them against the database before any request is handled.
 * Missing, wrong or unregistered keys stop the server: personal data is
 * written encrypted, so the app can't work without them. The same goes for
 * the backup file key (BACKUP_ENCRYPTION_SECRET_KEY): backups are always
 * saved encrypted.
 */
export async function initEncryption(): Promise<void> {
  const keyring = await loadKeyring();
  if (!keyring) {
    setKeyring(null);
    throw new Error(
      "No encryption key configured. Set PII_ENCRYPTION_SECRET_KEY (see azure/ENCRYPTION_KEYS.md).",
    );
  }

  const backupKeyring = await loadBackupKeyring();
  if (!backupKeyring) {
    throw new Error(
      "No backup encryption key configured. Set BACKUP_ENCRYPTION_SECRET_KEY (see azure/ENCRYPTION_KEYS.md).",
    );
  }

  try {
    const query = async (sql: string, params?: unknown[]) => ({ rows: await db.query(sql, params) });
    await verifyKeyFingerprints(keyring, query);
    await verifyBackupKeyFingerprints(backupKeyring, query);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "42P01") {
      throw new Error(
        "Table encryption_keys or backup_encryption_keys is missing. Apply azure/migrations/001_encryption.sql " +
          "and 005_backup_encryption_keys.sql first, then run node azure/register-keys.mjs.",
      );
    }
    throw error;
  }

  setKeyring(keyring);
  setBackupKeyring(backupKeyring);
  console.info(
    `[encryption] Keys loaded and verified (current key "${keyring.currentKeyId}", backup key "${backupKeyring.currentKeyId}").`,
  );
}

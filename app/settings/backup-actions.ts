"use server";

import { requireOwnerAction } from "@/lib/auth";
import { saveDailyBackup } from "@/lib/backup";
import { createBackupDownloadUrl, listBackupFiles } from "@/lib/storage";

export interface StoredBackup {
  name: string;
  /** YYYY-MM-DD the backup was taken. */
  date: string;
  bytes: number;
}

// The backups container is private, so it is read with the storage account's
// own key, but only after the signed-in owner is confirmed (requireOwnerAction).

/** Saved daily backups, newest first. */
export async function listStoredBackups(): Promise<{ backups?: StoredBackup[]; error?: string }> {
  const { error: authError } = await requireOwnerAction();
  if (authError) return { error: "Unauthorized" };

  let files;
  try {
    // Empty until the first backup creates the container.
    files = await listBackupFiles();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not list the backups." };
  }

  return {
    backups: files
      .filter((file) => /\d{4}-\d{2}-\d{2}/.test(file.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 100)
      .map((file) => ({
        name: file.name,
        date: file.name.match(/(\d{4}-\d{2}-\d{2})/)![1],
        bytes: file.bytes,
      })),
  };
}

/** A download link for one backup, valid for one minute. */
export async function getBackupDownloadUrl(name: string): Promise<{ url?: string; error?: string }> {
  const { error: authError } = await requireOwnerAction();
  if (authError) return { error: "Unauthorized" };
  if (!/^crest-crm-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(name)) {
    return { error: "Unknown backup." };
  }

  try {
    return { url: await createBackupDownloadUrl(name, 60) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the download link." };
  }
}

/** Takes a backup now (same as the nightly one). */
export async function backUpNow(): Promise<{ success?: boolean; error?: string }> {
  const { error: authError } = await requireOwnerAction();
  if (authError) return { error: "Unauthorized" };
  try {
    await saveDailyBackup();
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Backup failed." };
  }
}

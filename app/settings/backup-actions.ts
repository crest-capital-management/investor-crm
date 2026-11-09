"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { STORED_BACKUP_NAME, UPLOADED_BACKUP_NAME, saveDailyBackup, saveSafetyBackup } from "@/lib/backup";
import { RESTORE_TABLES, currentCounts, parseBackupFile, replaceAllData } from "@/lib/restore";
import { createBackupDownloadUrl, downloadBackupFile, listBackupFiles, removeBackupFiles } from "@/lib/storage";

export interface StoredBackup {
  name: string;
  /** YYYY-MM-DD the backup was taken. */
  date: string;
  /** "HH:MM" (UTC) for a safety copy taken just before a restore; null for a nightly backup. */
  beforeRestoreAt: string | null;
  bytes: number;
}

// The backups container is private, so it is read with the storage account's
// own key, but only after the signed-in owner is confirmed (requireActionAuth).

/** Saved backups, newest first. */
export async function listStoredBackups(): Promise<{ backups?: StoredBackup[]; error?: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  let files;
  try {
    // Empty until the first backup creates the container.
    files = await listBackupFiles();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not list the backups." };
  }

  const backups: StoredBackup[] = [];
  for (const file of files) {
    const match = file.name.match(STORED_BACKUP_NAME);
    if (!match) continue;
    backups.push({
      name: file.name,
      date: match[1],
      beforeRestoreAt: match[2] ? `${match[2].slice(0, 2)}:${match[2].slice(2, 4)}` : null,
      bytes: file.bytes,
    });
  }
  // Newest day first; within a day the latest safety copy first, the nightly backup last.
  backups.sort((a, b) =>
    a.date !== b.date ? b.date.localeCompare(a.date) : (b.beforeRestoreAt ?? "").localeCompare(a.beforeRestoreAt ?? ""),
  );
  return { backups: backups.slice(0, 100) };
}

/** A download link for one backup, valid for one minute. */
export async function getBackupDownloadUrl(name: string): Promise<{ url?: string; error?: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (!STORED_BACKUP_NAME.test(name)) {
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
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  try {
    await saveDailyBackup();
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Backup failed." };
  }
}

export interface RestorePreview {
  exportedAt: string | null;
  tables: Array<{ table: string; label: string; inBackup: number | null; current: number | null }>;
  warnings: string[];
}

function isRestorableName(name: string) {
  return STORED_BACKUP_NAME.test(name) || UPLOADED_BACKUP_NAME.test(name);
}

async function readBackup(name: string) {
  return parseBackupFile(await downloadBackupFile(name));
}

/** Reads a backup and shows what a restore would do. Changes nothing. */
export async function previewRestore(name: string): Promise<{ preview?: RestorePreview; error?: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (!isRestorableName(name)) return { error: "Unknown backup." };

  try {
    const backup = await readBackup(name);
    const counts = await currentCounts();
    const tables = RESTORE_TABLES.map(({ table, label }) => ({
      table,
      label,
      inBackup: backup.data[table]?.length ?? null,
      current: counts[table],
    }));

    const warnings: string[] = [];
    if ((backup.data.contacts?.length ?? 0) === 0) {
      warnings.push("This backup has no contacts. Restoring it would leave the CRM empty.");
    }
    if (backup.data.broadcast_recipients === undefined) {
      warnings.push("This backup has no broadcast recipients list (older backup); that list will be emptied.");
    }
    if (backup.data.app_settings === undefined) {
      warnings.push("This backup has no settings; your current settings will be kept.");
    }
    if (backup.data.contact_sections === undefined && counts.contact_sections !== null) {
      warnings.push(
        "This backup is from before sections (tabs) existed; your current sections are kept and the restored contacts will have no section. You can move them afterwards.",
      );
    }
    return { preview: { exportedAt: backup.exportedAt, tables, warnings } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The backup could not be read." };
  }
}

/**
 * Replaces all CRM data with the backup. A safety backup of the current data is
 * saved first; if that fails, nothing is restored. Logins are not touched.
 */
export async function restoreFromBackup(
  name: string,
  confirmation: string,
): Promise<{ counts?: Record<string, number>; safetyBackup?: string; error?: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (!isRestorableName(name)) return { error: "Unknown backup." };
  if (confirmation.trim() !== "RESTORE") return { error: 'Type RESTORE to confirm.' };

  let backup;
  try {
    backup = await readBackup(name);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The backup could not be read." };
  }

  let safetyBackup: string;
  try {
    safetyBackup = await saveSafetyBackup();
  } catch (err) {
    return {
      error: `The safety backup of your current data could not be saved, so nothing was restored. ${
        err instanceof Error ? err.message : ""
      }`.trim(),
    };
  }

  let counts: Record<string, number>;
  try {
    counts = await replaceAllData(backup);
  } catch (err) {
    return {
      error: `The backup could not be restored, and nothing was changed. ${err instanceof Error ? err.message : ""}`.trim(),
    };
  }

  if (UPLOADED_BACKUP_NAME.test(name)) {
    await removeBackupFiles([name]).catch(() => undefined);
  }
  revalidatePath("/", "layout");
  return { counts, safetyBackup };
}

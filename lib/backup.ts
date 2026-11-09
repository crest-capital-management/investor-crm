import { gzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { listBackupFiles, removeBackupFiles, saveBackupFile } from "@/lib/storage";
import { CRM_TABLES } from "@/lib/crm-tables";

/** Daily backups older than this are deleted. */
export const BACKUP_RETENTION_DAYS = 30;

export interface CrmBackup {
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/** Every CRM table, including soft-deleted rows. Throws if a required table fails. */
export async function buildCrmBackup(): Promise<CrmBackup> {
  const data: Record<string, unknown[]> = {};
  for (const { table, orderBy, optional } of CRM_TABLES) {
    try {
      // Table and column names come from the fixed list in lib/crm-tables.ts, never from user input.
      data[table] = await db.query(`select * from public.${table} order by ${orderBy.join(", ")}`);
    } catch (err) {
      if (!optional) throw err;
    }
  }
  return {
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    data,
  };
}

/**
 * Backup file names in the "backups" container:
 *   crest-crm-backup-2026-11-06.json.gz                       nightly / "Back up now"
 *   crest-crm-backup-2026-11-06-before-restore-141502.json.gz safety copy taken just before a restore
 *   upload-1762430000000.json.gz                              a file uploaded for a restore (hidden from the list)
 */
export const STORED_BACKUP_NAME = /^crest-crm-backup-(\d{4}-\d{2}-\d{2})(?:-before-restore-(\d{6}))?\.json\.gz$/;
export const UPLOADED_BACKUP_NAME = /^upload-\d{13}\.json\.gz$/;

async function writeBackup(path: string, backup: CrmBackup): Promise<number> {
  const compressed = gzipSync(Buffer.from(JSON.stringify(backup)));
  try {
    await saveBackupFile(path, compressed);
  } catch (err) {
    throw new Error(`Could not save the backup: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  return compressed.length;
}

/**
 * Saves a backup of the data as it is right now, under its own name, so a
 * restore can be undone. Never replaces the day's nightly backup.
 */
export async function saveSafetyBackup(): Promise<string> {
  const backup = await buildCrmBackup();
  const time = backup.exportedAt.slice(11, 19).replace(/:/g, "");
  const path = `crest-crm-backup-${backup.exportedAt.slice(0, 10)}-before-restore-${time}.json.gz`;
  await writeBackup(path, backup);
  return path;
}

/**
 * Saves today's compressed backup to the private "backups" storage container
 * (created on first use) and deletes backups older than the retention period.
 */
export async function saveDailyBackup(): Promise<{
  path: string;
  bytes: number;
  counts: Record<string, number>;
  removed: number;
}> {
  const backup = await buildCrmBackup();
  const path = `crest-crm-backup-${backup.exportedAt.slice(0, 10)}.json.gz`;
  const bytes = await writeBackup(path, backup);

  // Remove backups past the retention period, and restore uploads older than a day.
  const files = await listBackupFiles();
  const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const uploadCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const expired = files
    .map((file) => file.name)
    .filter((name) => {
      if (UPLOADED_BACKUP_NAME.test(name)) return Number(name.slice(7, 20)) < uploadCutoff;
      const date = name.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
      return date !== undefined && date < cutoff;
    });
  if (expired.length) {
    await removeBackupFiles(expired);
  }

  return { path, bytes, counts: backup.counts, removed: expired.length };
}

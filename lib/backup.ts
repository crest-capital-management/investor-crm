import { gzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { listBackupFiles, removeBackupFiles, saveBackupFile } from "@/lib/storage";

// Each table is read in a stable order.
const BACKUP_TABLES: Array<{ table: string; orderBy: string[]; optional?: boolean }> = [
  { table: "contact_sections", orderBy: ["id"], optional: true },
  { table: "contacts", orderBy: ["id"] },
  { table: "groups", orderBy: ["id"] },
  { table: "contact_groups", orderBy: ["contact_id", "group_id"] },
  { table: "interactions", orderBy: ["id"] },
  { table: "follow_ups", orderBy: ["id"] },
  { table: "templates", orderBy: ["id"] },
  { table: "broadcasts", orderBy: ["id"] },
  { table: "broadcast_recipients", orderBy: ["id"], optional: true },
  { table: "whatsapp_messages", orderBy: ["id"] },
  { table: "portfolio_updates", orderBy: ["id"] },
  { table: "app_settings", orderBy: ["id"], optional: true },
];

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
  for (const { table, orderBy, optional } of BACKUP_TABLES) {
    try {
      // Table and column names come from the fixed list above, never from user input.
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
  const compressed = gzipSync(Buffer.from(JSON.stringify(backup)));
  const path = `crest-crm-backup-${backup.exportedAt.slice(0, 10)}.json.gz`;

  try {
    await saveBackupFile(path, compressed);
  } catch (err) {
    throw new Error(`Could not save the backup: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // Remove backups past the retention period.
  const files = await listBackupFiles();
  const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const expired = files
    .map((file) => file.name)
    .filter((name) => {
      const date = name.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
      return date !== undefined && date < cutoff;
    });
  if (expired.length) {
    await removeBackupFiles(expired);
  }

  return { path, bytes: compressed.length, counts: backup.counts, removed: expired.length };
}

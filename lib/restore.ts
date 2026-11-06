import { gunzipSync } from "node:zlib";
import { db, type Queryable } from "@/lib/db";

/**
 * Restoring a full backup (made by lib/backup.ts, or downloaded as JSON from
 * My Profile): every CRM table is emptied and refilled from the backup in one
 * transaction, so either all of it is restored or nothing changes. Logins
 * (crm_users) are never touched.
 */

/** Insert order (parents before children); deletes run in reverse. */
export const RESTORE_TABLES: Array<{ table: string; label: string; optional?: boolean }> = [
  { table: "contacts", label: "Contacts" },
  { table: "groups", label: "Groups" },
  { table: "templates", label: "Templates" },
  { table: "contact_groups", label: "Group memberships" },
  { table: "interactions", label: "Meeting notes" },
  { table: "follow_ups", label: "Follow-ups" },
  { table: "broadcasts", label: "Broadcasts" },
  { table: "broadcast_recipients", label: "Broadcast recipients", optional: true },
  { table: "whatsapp_messages", label: "WhatsApp messages" },
  { table: "portfolio_updates", label: "Portfolio updates" },
  { table: "app_settings", label: "Settings", optional: true },
];

const INSERT_CHUNK_ROWS = 1000;
// Far above any real backup; stops a bad file from using up the server's memory.
const MAX_UNZIPPED_BYTES = 500 * 1024 * 1024;

export interface ParsedBackup {
  exportedAt: string | null;
  /** Rows per table. A table missing from the backup is absent here. */
  data: Record<string, Record<string, unknown>[]>;
}

/** Reads a backup file (gzipped or plain JSON) and checks it looks like a CRM backup. */
export function parseBackupFile(bytes: Buffer): ParsedBackup {
  let text: string;
  try {
    const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    text = (isGzip ? gunzipSync(bytes, { maxOutputLength: MAX_UNZIPPED_BYTES }) : bytes).toString("utf8");
  } catch {
    throw new Error("The file could not be unpacked. Please use a CRM backup (.json or .json.gz).");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not a CRM backup (it is not valid JSON).");
  }

  const root = parsed as { exportedAt?: unknown; data?: unknown } | null;
  if (!root || typeof root !== "object" || !root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
    throw new Error("This file is not a CRM backup (no data section).");
  }
  const rawData = root.data as Record<string, unknown>;

  const data: ParsedBackup["data"] = {};
  for (const { table, label, optional } of RESTORE_TABLES) {
    const rows = rawData[table];
    if (rows === undefined && optional) continue;
    if (!Array.isArray(rows)) {
      throw new Error(`This file is not a complete CRM backup (${label} are missing).`);
    }
    if (!rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
      throw new Error(`This backup is damaged (${label} contain invalid rows).`);
    }
    data[table] = rows as Record<string, unknown>[];
  }

  return { exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : null, data };
}

/** Row counts in the live database, per table (null if the table does not exist). */
export async function currentCounts(): Promise<Record<string, number | null>> {
  const existing = await existingTables(db);
  const counts: Record<string, number | null> = {};
  for (const { table } of RESTORE_TABLES) {
    // Table names come from the fixed list above, never from the file.
    counts[table] = existing.has(table)
      ? (await db.one<{ n: number }>(`select count(*)::int as n from public.${table}`)).n
      : null;
  }
  return counts;
}

async function existingTables(q: Queryable): Promise<Set<string>> {
  const rows = await q.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)",
    [RESTORE_TABLES.map((t) => t.table)],
  );
  return new Set(rows.map((r) => r.table_name));
}

class DryRunFinished extends Error {
  counts: Record<string, number>;
  constructor(counts: Record<string, number>) {
    super("dry run");
    this.counts = counts;
  }
}

/**
 * Replaces every CRM table with the backup's rows, in one transaction.
 * A table the backup does not have is treated as empty, except Settings,
 * which then stay as they are. With dryRun everything is done and checked,
 * then rolled back (used for testing).
 * Returns the restored row counts.
 */
export async function replaceAllData(
  backup: ParsedBackup,
  options: { dryRun?: boolean; inspect?: (tx: Queryable) => Promise<void> } = {},
): Promise<Record<string, number>> {
  try {
    return await db.tx(async (tx) => {
      const existing = await existingTables(tx);
      const tables = RESTORE_TABLES.filter(({ table, optional }) => {
        if (!existing.has(table)) {
          if (optional) return false;
          throw new Error(`The database has no ${table} table. Run the database setup first.`);
        }
        // Settings missing from the backup are kept; other missing tables are emptied.
        return !(table === "app_settings" && backup.data[table] === undefined);
      });

      // No one else can change these tables until the restore is finished (reading still works).
      await tx.execute(`lock table ${tables.map((t) => `public.${t.table}`).join(", ")} in exclusive mode`);

      const columnRows = await tx.query<{ table_name: string; column_name: string }>(
        "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1)",
        [tables.map((t) => t.table)],
      );

      // Children first, so no row is left pointing at a deleted parent.
      for (const { table } of [...tables].reverse()) {
        await tx.execute(`delete from public.${table}`);
      }

      for (const { table } of tables) {
        const rows = backup.data[table] ?? [];
        if (rows.length === 0) continue;

        // Only columns both the table and the backup have: an older backup lacking a
        // newer column leaves it to its default, and unknown keys in the file are ignored.
        const tableColumns = new Set(columnRows.filter((c) => c.table_name === table).map((c) => c.column_name));
        const backupColumns = new Set<string>();
        for (const row of rows) for (const key of Object.keys(row)) backupColumns.add(key);
        const columns = [...tableColumns].filter((c) => backupColumns.has(c));
        const list = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");

        for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
          const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS);
          await tx.execute(
            `insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`,
            [JSON.stringify(chunk)],
          );
        }
      }

      // Inserting messages fires a trigger that rewrites each contact's "last message"
      // fields; put back the values the backup recorded.
      const contacts = backup.data.contacts ?? [];
      if (contacts.length > 0 && "last_message_at" in contacts[0]) {
        const lastMessages = contacts.map((c) => ({
          id: c.id,
          last_message_at: c.last_message_at ?? null,
          last_message_text: c.last_message_text ?? null,
          last_message_direction: c.last_message_direction ?? null,
        }));
        for (let start = 0; start < lastMessages.length; start += INSERT_CHUNK_ROWS) {
          await tx.execute(
            `update public.contacts c
                set last_message_at = r.last_message_at,
                    last_message_text = r.last_message_text,
                    last_message_direction = r.last_message_direction
               from jsonb_to_recordset($1::jsonb)
                 as r(id uuid, last_message_at timestamptz, last_message_text text, last_message_direction text)
              where c.id = r.id`,
            [JSON.stringify(lastMessages.slice(start, start + INSERT_CHUNK_ROWS))],
          );
        }
      }

      // Check every table now holds exactly what the backup has.
      const counts: Record<string, number> = {};
      for (const { table, label } of tables) {
        const { n } = await tx.one<{ n: number }>(`select count(*)::int as n from public.${table}`);
        const expected = (backup.data[table] ?? []).length;
        if (n !== expected) {
          throw new Error(`${label}: expected ${expected} rows after the restore but found ${n}. Nothing was changed.`);
        }
        counts[table] = n;
      }

      // Testing only: look at the restored data before it is rolled back.
      if (options.inspect) await options.inspect(tx);
      if (options.dryRun) throw new DryRunFinished(counts);
      return counts;
    });
  } catch (err) {
    if (err instanceof DryRunFinished) return err.counts;
    throw err;
  }
}

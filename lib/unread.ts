import { db } from "@/lib/db";

/**
 * Unread inbound WhatsApp message counts keyed by contact id, from the
 * unread_conversations() SQL function. Returns an empty object on error so a
 * failed lookup never breaks the page that shows the badges.
 */
export async function getUnreadCountsByContact(): Promise<Record<string, number>> {
  let rows: Array<{ contact_id: string; unread_count: number }>;
  try {
    rows = await db.query<{ contact_id: string; unread_count: number }>(
      "select contact_id, unread_count from public.unread_conversations()",
    );
  } catch {
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.contact_id] = Number(row.unread_count);
  }
  return counts;
}

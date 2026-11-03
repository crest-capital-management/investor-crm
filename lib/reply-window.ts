import { db } from "@/lib/db";

/**
 * Meta only delivers free-form messages within 24 hours of the contact's last
 * message (its "customer service window"). Outside it they are silently dropped.
 */
export async function isReplyWindowOpen(contactId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const row = await db.one<{ count: number }>(
      `select count(*)::int as count
         from public.whatsapp_messages
        where contact_id = $1 and direction = 'in' and deleted_at is null and sent_at >= $2`,
      [contactId, since],
    );
    return row.count > 0;
  } catch {
    // If the check itself fails, don't block the user; Meta stays the final judge.
    return true;
  }
}

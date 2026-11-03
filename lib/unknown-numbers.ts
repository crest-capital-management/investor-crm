import { db } from "@/lib/db";

export interface UnknownConversation {
  /** 10-digit local number, as contacts are stored. */
  phone: string;
  /** Name the sender set in WhatsApp, if Meta sent one. */
  profileName: string | null;
  messageCount: number;
  lastMessageAt: string;
  lastMessageText: string | null;
  hasMedia: boolean;
}

/**
 * Numbers that messaged on WhatsApp but aren't saved as contacts, newest
 * first. Returns [] on error (e.g. before the phone column migration is run).
 */
export async function getUnknownConversations(): Promise<UnknownConversation[]> {
  type Row = {
    phone: string;
    profile_name: string | null;
    message_text: string | null;
    media_url: string | null;
    sent_at: string;
  };
  let data: Row[];
  try {
    data = await db.query<Row>(
      `select phone, profile_name, message_text, media_url, sent_at
         from whatsapp_messages
        where contact_id is null and direction = 'in' and phone is not null and deleted_at is null
        order by sent_at desc
        limit 1000`,
    );
  } catch {
    return [];
  }

  const byPhone = new Map<string, UnknownConversation>();
  for (const row of data) {
    const phone = row.phone;
    const existing = byPhone.get(phone);
    if (existing) {
      existing.messageCount++;
      existing.profileName ??= row.profile_name ?? null;
      continue;
    }
    byPhone.set(phone, {
      phone,
      profileName: row.profile_name ?? null,
      messageCount: 1,
      lastMessageAt: row.sent_at,
      lastMessageText: row.message_text ?? null,
      hasMedia: Boolean(row.media_url),
    });
  }
  return [...byPhone.values()];
}

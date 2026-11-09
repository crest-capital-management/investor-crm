import { db } from "@/lib/db";

/**
 * What the AI features (message drafting, prospect scoring, chat summary) read
 * about a contact, and small helpers for turning it into prompt text. Each
 * feature still writes its own prompt; only the plumbing is shared.
 */

export type HistoryMessage = { direction: string | null; message_text: string | null; sent_at: string | null; created_at: string };
export type HistoryNote = { note: string; created_at: string };
export type HistoryFollowUp = { due_date: string; message: string; is_done: boolean };

export type ContactHistory = {
  messages: HistoryMessage[];
  meetingNotes: HistoryNote[];
  followUps: HistoryFollowUp[];
};

/** A contact's WhatsApp messages, meeting notes and follow-ups (oldest first). Throws if a query fails. */
export async function loadContactHistory(contactId: string): Promise<ContactHistory> {
  const [messages, meetingNotes, followUps] = await Promise.all([
    db.query<HistoryMessage>(
      `select direction, message_text, sent_at, created_at
         from public.whatsapp_messages
        where contact_id = $1 and deleted_at is null
        order by sent_at asc`,
      [contactId],
    ),
    db.query<HistoryNote>(
      `select note, created_at
         from public.interactions
        where contact_id = $1 and type = 'meeting' and deleted_at is null
        order by created_at asc`,
      [contactId],
    ),
    db.query<HistoryFollowUp>(
      `select due_date, message, is_done
         from public.follow_ups
        where contact_id = $1 and deleted_at is null`,
      [contactId],
    ),
  ]);
  return { messages, meetingNotes, followUps };
}

/** Collapses whitespace and cuts long text to `max` characters (adding "..."). */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

/** True for a message the contact sent (stored as "in"; older rows may say "inbound"). */
export function isInbound(direction: string | null | undefined): boolean {
  return direction === "in" || direction?.toLowerCase() === "inbound";
}

/** A copy of the messages, oldest first by when they were sent. */
export function chronological<T extends { sent_at: string | null; created_at: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => new Date(a.sent_at || a.created_at).getTime() - new Date(b.sent_at || b.created_at).getTime(),
  );
}

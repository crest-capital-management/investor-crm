"use server";

import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { draftMessage, type DraftInput } from "@/lib/message-drafting";
import { isReplyWindowOpen } from "@/lib/reply-window";

/**
 * Drafts a personalised message for a contact. Nothing is saved or sent: the
 * owner reviews the text, then copies it or sends it with sendWhatsAppReply.
 * `windowOpen` says whether WhatsApp would currently deliver a free-form message.
 */
export async function generatePersonalisedMessage(
  contactId: string,
): Promise<{ message: string; windowOpen: boolean } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  const id = contactId.trim();
  let contact: DraftInput["contact"] | null;
  try {
    contact = await db.maybeOne<DraftInput["contact"]>(
      `select id, name, company, tags, notes from public.contacts where id = $1 and deleted_at is null`,
      [id],
    );
  } catch {
    contact = null;
  }
  if (!contact) return { error: "The contact could not be found." };

  let messages: DraftInput["messages"];
  let notes: DraftInput["meetingNotes"];
  let followUps: DraftInput["followUps"];
  let windowOpen: boolean;
  try {
    [messages, notes, followUps, windowOpen] = await Promise.all([
      db.query<DraftInput["messages"][number]>(
        `select direction, message_text, sent_at, created_at
           from public.whatsapp_messages
          where contact_id = $1 and deleted_at is null
          order by sent_at asc`,
        [id],
      ),
      db.query<DraftInput["meetingNotes"][number]>(
        `select note, created_at
           from public.interactions
          where contact_id = $1 and type = 'meeting' and deleted_at is null
          order by created_at asc`,
        [id],
      ),
      db.query<DraftInput["followUps"][number]>(
        `select due_date, message, is_done
           from public.follow_ups
          where contact_id = $1 and deleted_at is null`,
        [id],
      ),
      isReplyWindowOpen(id),
    ]);
  } catch {
    return { error: "Could not load the contact's messages, notes or follow-ups." };
  }

  try {
    const message = await draftMessage({
      todayIsoDate: new Date().toISOString().slice(0, 10),
      contact,
      messages,
      meetingNotes: notes,
      followUps,
    });
    return { message, windowOpen };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "The message could not be generated." };
  }
}

"use server";

import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { draftMessage, type DraftInput } from "@/lib/message-drafting";
import { isReplyWindowOpen } from "@/lib/reply-window";
import { loadContactHistory, type ContactHistory } from "@/lib/ai-context";
import { todayAsISODate } from "@/lib/format";

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

  let history: ContactHistory;
  let windowOpen: boolean;
  try {
    [history, windowOpen] = await Promise.all([loadContactHistory(id), isReplyWindowOpen(id)]);
  } catch {
    return { error: "Could not load the contact's messages, notes or follow-ups." };
  }

  try {
    const message = await draftMessage({ todayIsoDate: todayAsISODate(), contact, ...history });
    return { message, windowOpen };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "The message could not be generated." };
  }
}

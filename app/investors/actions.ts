"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateFollowUpSuggestion } from "@/lib/gemini";

export type FollowUp = {
  id: string;
  due_date: string;
  message: string;
  is_done: boolean;
  created_at: string;
};

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(value.slice(0, 4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getUTCDate() === Number(value.slice(8, 10))
  );
}

function todayAsISODate() {
  return new Date().toISOString().slice(0, 10);
}

/** The contact row the follow-up actions check for (null when it doesn't exist or the lookup failed). */
async function findContact(contactId: string) {
  try {
    return await db.maybeOne<{ id: string; tags: string[] | null }>(
      `select id, tags from public.contacts where id = $1`,
      [contactId],
    );
  } catch {
    return null;
  }
}

type FollowUpCheck = { id: string; contact_id: string | null; message: string | null; is_done: boolean | null };

async function findFollowUp(followUpId: string) {
  try {
    return await db.maybeOne<FollowUpCheck>(
      `select id, contact_id, message, is_done from public.follow_ups where id = $1`,
      [followUpId],
    );
  } catch {
    return null;
  }
}

export async function getFollowUps(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  let followUps: FollowUp[];
  try {
    followUps = await db.query<FollowUp>(
      `select id, due_date, message, is_done, created_at
       from public.follow_ups
       where contact_id = $1 and deleted_at is null
       order by is_done asc, due_date asc, created_at asc`,
      [normalizedContactId],
    );
  } catch {
    return { error: "Follow-ups could not be loaded." };
  }

  return { followUps };
}

export type SuggestFollowUpResult =
  | { success: true; needed: true; dueDate: string; message: string }
  | { success: true; needed: false }
  | { error: string };

/**
 * Uses AI (Gemini) to suggest a follow-up for an investor based on their
 * WhatsApp history and meeting notes. This only returns a suggestion for
 * the user to review — it does not save anything. The user still confirms
 * and saves it through the existing addFollowUp flow (the manual Add
 * Follow-up dialog, pre-filled with this suggestion).
 */
export async function suggestFollowUp(
  contactId: string,
): Promise<SuggestFollowUpResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  const contact = await findContact(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  type MessageRow = { direction: string; message_text: string | null; sent_at: string; created_at: string };
  type NoteRow = { note: string; created_at: string };
  let messages: MessageRow[];
  let notes: NoteRow[];
  try {
    [messages, notes] = await Promise.all([
      db.query<MessageRow>(
        `select direction, message_text, sent_at, created_at
         from public.whatsapp_messages
         where contact_id = $1 and deleted_at is null
         order by sent_at asc`,
        [normalizedContactId],
      ),
      db.query<NoteRow>(
        `select note, created_at
         from public.interactions
         where contact_id = $1 and type = 'meeting' and deleted_at is null
         order by created_at asc`,
        [normalizedContactId],
      ),
    ]);
  } catch {
    return { error: "Could not load WhatsApp history or meeting notes." };
  }

  try {
    const suggestion = await generateFollowUpSuggestion(
      messages,
      notes,
      todayAsISODate(),
    );

    if (!suggestion.needed) {
      return { success: true, needed: false };
    }

    return {
      success: true,
      needed: true,
      dueDate: suggestion.dueDate,
      message: suggestion.message,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate a follow-up suggestion.";
    return { error: msg };
  }
}

export async function addFollowUp(
  contactId: string,
  dueDate: string,
  message: string,
) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  const normalizedDueDate = dueDate.trim();
  const normalizedMessage = message.trim();

  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!isValidDate(normalizedDueDate)) return { error: "Select a valid follow-up date." };
  if (normalizedDueDate < todayAsISODate()) {
    return { error: "Follow-up date cannot be before today." };
  }
  if (!normalizedMessage) return { error: "Follow-up message is required." };

  const contact = await findContact(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  try {
    await db.execute(
      `insert into public.follow_ups (contact_id, due_date, message, is_done) values ($1, $2, $3, false)`,
      [normalizedContactId, normalizedDueDate, normalizedMessage],
    );
  } catch {
    return { error: "The follow-up could not be saved." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  revalidatePath(`/contacts/${normalizedContactId}`);
  return { success: true };
}

export async function markFollowUpAsDone(followUpId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };

  const contact = await findContact(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  // 2. Verify follow-up exists, belongs to contact, and is not already done
  const followUp = await findFollowUp(normalizedFollowUpId);
  if (!followUp) return { error: "Follow-up not found." };

  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }

  if (followUp.is_done) {
    return { error: "This follow-up has already been completed." };
  }

  // 3. Insert interaction record representing the completed follow-up
  // The interaction and the "done" flag are saved together, so an orphaned interaction is never left behind.
  let recorded = false;
  try {
    recorded = await db.tx(async (tx) => {
      await tx.execute(
        `insert into public.interactions (contact_id, type, note) values ($1, 'follow_up', $2)`,
        [normalizedContactId, followUp.message],
      );
      // Conditional on is_done = false to avoid a race with another completion.
      const updated = await tx.execute(
        `update public.follow_ups set is_done = true where id = $1 and is_done = false`,
        [normalizedFollowUpId],
      );
      if (updated === 0) throw new Error("Follow-up was already completed.");
      return true;
    });
  } catch {
    recorded = false;
  }
  if (!recorded) return { error: "Failed to mark follow-up as done." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  revalidatePath(`/contacts/${normalizedContactId}`);
  return { success: true };
}

export async function editFollowUp(
  followUpId: string,
  contactId: string,
  dueDate: string,
  message: string,
) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();
  const normalizedDueDate = dueDate.trim();
  const normalizedMessage = message.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!isValidDate(normalizedDueDate)) return { error: "Select a valid follow-up date." };
  if (normalizedDueDate < todayAsISODate()) {
    return { error: "Follow-up date cannot be before today." };
  }
  if (!normalizedMessage) return { error: "Follow-up message is required." };

  const contact = await findContact(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  // Verify follow-up exists, belongs to contact, and is pending (is_done === false)
  const followUp = await findFollowUp(normalizedFollowUpId);
  if (!followUp) return { error: "Follow-up not found." };
  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }
  if (followUp.is_done) {
    return { error: "Completed follow-ups cannot be edited." };
  }

  try {
    await db.execute(
      `update public.follow_ups set due_date = $1, message = $2 where id = $3 and is_done = false`,
      [normalizedDueDate, normalizedMessage, normalizedFollowUpId],
    );
  } catch {
    return { error: "The follow-up could not be updated." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  revalidatePath(`/contacts/${normalizedContactId}`);
  return { success: true };
}

export async function deleteFollowUp(followUpId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };

  const contact = await findContact(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  // Verify follow-up exists, belongs to contact, and is pending (is_done === false)
  const followUp = await findFollowUp(normalizedFollowUpId);
  if (!followUp) return { error: "Follow-up not found." };
  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }
  if (followUp.is_done) {
    return { error: "This follow-up is completed and must be deleted using the completed follow-up deletion flow." };
  }

  try {
    await db.execute(
      `update public.follow_ups set deleted_at = $1 where id = $2 and is_done = false`,
      [new Date().toISOString(), normalizedFollowUpId],
    );
  } catch {
    return { error: "The follow-up could not be deleted." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  revalidatePath(`/contacts/${normalizedContactId}`);
  return { success: true };
}

export async function deleteCompletedFollowUp(followUpId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };

  const contact = await findContact(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  // Verify follow-up exists, belongs to contact, and is completed (is_done === true)
  const followUp = await findFollowUp(normalizedFollowUpId);
  if (!followUp) return { error: "Follow-up not found." };
  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }
  if (!followUp.is_done) {
    return { error: "This follow-up is not completed." };
  }

  // Delete only the completed follow-up row. Historical interaction is preserved
  // because the schema does not link follow_up_id to interaction_id, preventing accidental
  // deletion of other follow_up interactions with identical messages.
  try {
    await db.execute(
      `update public.follow_ups set deleted_at = $1 where id = $2 and is_done = true`,
      [new Date().toISOString(), normalizedFollowUpId],
    );
  } catch {
    return { error: "The completed follow-up could not be deleted." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  revalidatePath(`/contacts/${normalizedContactId}`);
  return { success: true };
}


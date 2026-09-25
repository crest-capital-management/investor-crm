"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { isInvestorTag } from "@/lib/tags";

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

export async function getFollowUps(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The investor could not be found." };

  const { data: followUps, error } = await supabase
    .from("follow_ups")
    .select("id, due_date, message, is_done, created_at")
    .eq("contact_id", normalizedContactId)
    .is("deleted_at", null)
    .order("is_done", { ascending: true })
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return { error: "Follow-ups could not be loaded." };

  return { followUps: (followUps ?? []) as FollowUp[] };
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

  if (!normalizedContactId) return { error: "The investor could not be found." };
  if (!isValidDate(normalizedDueDate)) return { error: "Select a valid follow-up date." };
  if (normalizedDueDate < todayAsISODate()) {
    return { error: "Follow-up date cannot be before today." };
  }
  if (!normalizedMessage) return { error: "Follow-up message is required." };

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tags")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The investor could not be found." };

  const isInvestor = Array.isArray(contact.tags) && contact.tags.some(
    (tag: string) => isInvestorTag(tag),
  );
  if (!isInvestor) return { error: "Follow-ups are only available for investors." };

  const { error } = await supabase.from("follow_ups").insert({
    contact_id: normalizedContactId,
    due_date: normalizedDueDate,
    message: normalizedMessage,
    is_done: false,
  });

  if (error) return { error: "The follow-up could not be saved." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export async function markFollowUpAsDone(followUpId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The investor could not be found." };

  // 1. Verify contact exists and is an investor
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tags")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) {
    return { error: "The investor could not be found." };
  }

  const isInvestor =
    Array.isArray(contact.tags) &&
    contact.tags.some((tag: string) => isInvestorTag(tag));
  if (!isInvestor) {
    return { error: "Follow-ups are only available for investors." };
  }

  // 2. Verify follow-up exists, belongs to contact, and is not already done
  const { data: followUp, error: followUpError } = await supabase
    .from("follow_ups")
    .select("id, contact_id, message, is_done")
    .eq("id", normalizedFollowUpId)
    .maybeSingle();

  if (followUpError || !followUp) {
    return { error: "Follow-up not found." };
  }

  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }

  if (followUp.is_done) {
    return { error: "This follow-up has already been completed." };
  }

  // 3. Insert interaction record representing the completed follow-up
  const { data: interaction, error: interactionError } = await supabase
    .from("interactions")
    .insert({
      contact_id: normalizedContactId,
      type: "follow_up",
      note: followUp.message,
    })
    .select("id")
    .single();

  if (interactionError || !interaction) {
    return { error: "Could not record the follow-up interaction." };
  }

  // 4. Update the follow-up to done (conditional on is_done=false to avoid race condition)
  const { data: updatedFollowUps, error: updateError } = await supabase
    .from("follow_ups")
    .update({ is_done: true })
    .eq("id", normalizedFollowUpId)
    .eq("is_done", false)
    .select("id");

  if (updateError || !updatedFollowUps || updatedFollowUps.length === 0) {
    // Compensating rollback: delete created interaction to prevent orphaned interaction
    await supabase.from("interactions").delete().eq("id", interaction.id);
    return { error: "Failed to mark follow-up as done." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
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
  if (!normalizedContactId) return { error: "The investor could not be found." };
  if (!isValidDate(normalizedDueDate)) return { error: "Select a valid follow-up date." };
  if (normalizedDueDate < todayAsISODate()) {
    return { error: "Follow-up date cannot be before today." };
  }
  if (!normalizedMessage) return { error: "Follow-up message is required." };

  // Verify contact exists and is an investor
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tags")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The investor could not be found." };

  const isInvestor =
    Array.isArray(contact.tags) &&
    contact.tags.some((tag: string) => isInvestorTag(tag));
  if (!isInvestor) return { error: "Follow-ups are only available for investors." };

  // Verify follow-up exists, belongs to contact, and is pending (is_done === false)
  const { data: followUp, error: followUpError } = await supabase
    .from("follow_ups")
    .select("id, contact_id, is_done")
    .eq("id", normalizedFollowUpId)
    .maybeSingle();

  if (followUpError || !followUp) return { error: "Follow-up not found." };
  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }
  if (followUp.is_done) {
    return { error: "Completed follow-ups cannot be edited." };
  }

  const { error: updateError } = await supabase
    .from("follow_ups")
    .update({
      due_date: normalizedDueDate,
      message: normalizedMessage,
    })
    .eq("id", normalizedFollowUpId)
    .eq("is_done", false);

  if (updateError) return { error: "The follow-up could not be updated." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export async function deleteFollowUp(followUpId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The investor could not be found." };

  // Verify contact exists and is an investor
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tags")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The investor could not be found." };

  const isInvestor =
    Array.isArray(contact.tags) &&
    contact.tags.some((tag: string) => isInvestorTag(tag));
  if (!isInvestor) return { error: "Follow-ups are only available for investors." };

  // Verify follow-up exists, belongs to contact, and is pending (is_done === false)
  const { data: followUp, error: followUpError } = await supabase
    .from("follow_ups")
    .select("id, contact_id, is_done")
    .eq("id", normalizedFollowUpId)
    .maybeSingle();

  if (followUpError || !followUp) return { error: "Follow-up not found." };
  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }
  if (followUp.is_done) {
    return { error: "This follow-up is completed and must be deleted using the completed follow-up deletion flow." };
  }

  const { error: deleteError } = await supabase
    .from("follow_ups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", normalizedFollowUpId)
    .eq("is_done", false);

  if (deleteError) return { error: "The follow-up could not be deleted." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export async function deleteCompletedFollowUp(followUpId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedFollowUpId = followUpId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedFollowUpId) return { error: "Invalid follow-up ID." };
  if (!normalizedContactId) return { error: "The investor could not be found." };

  // Verify contact exists and is an investor
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tags")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The investor could not be found." };

  const isInvestor =
    Array.isArray(contact.tags) &&
    contact.tags.some((tag: string) => isInvestorTag(tag));
  if (!isInvestor) return { error: "Follow-ups are only available for investors." };

  // Verify follow-up exists, belongs to contact, and is completed (is_done === true)
  const { data: followUp, error: followUpError } = await supabase
    .from("follow_ups")
    .select("id, contact_id, is_done")
    .eq("id", normalizedFollowUpId)
    .maybeSingle();

  if (followUpError || !followUp) return { error: "Follow-up not found." };
  if (followUp.contact_id !== normalizedContactId) {
    return { error: "Follow-up does not belong to this investor." };
  }
  if (!followUp.is_done) {
    return { error: "This follow-up is not completed." };
  }

  // Delete only the completed follow-up row. Historical interaction is preserved
  // because the schema does not link follow_up_id to interaction_id, preventing accidental
  // deletion of other follow_up interactions with identical messages.
  const { error: deleteError } = await supabase
    .from("follow_ups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", normalizedFollowUpId)
    .eq("is_done", true);

  if (deleteError) return { error: "The completed follow-up could not be deleted." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}



"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import {
  normalizePhoneForWhatsApp,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";

export type TargetType = "group" | "tag" | "manual";

export interface CreateBroadcastDraftInput {
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
}

export interface UpdateBroadcastInput {
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  scheduled_for?: string;
}

export interface CreateScheduledBroadcastInput {
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  scheduled_for: string;
}

export async function createBroadcastDraft(data: CreateBroadcastDraftInput) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  const messageText = (data?.message_text ?? "").trim();
  if (!messageText) {
    return { error: "Message text is required." };
  }

  const validTargetTypes: TargetType[] = ["group", "tag", "manual"];
  if (!validTargetTypes.includes(data?.target_type)) {
    return { error: "Target type must be 'group', 'tag', or 'manual'." };
  }

  if (!Array.isArray(data?.target_ids) || data.target_ids.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  // Filter out any empty strings or invalid entries
  const normalizedTargetIds = data.target_ids
    .map((id) => String(id).trim())
    .filter(Boolean);

  if (normalizedTargetIds.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  const { error } = await supabase.from("broadcasts").insert({
    message_text: messageText,
    target_type: data.target_type,
    target_ids: normalizedTargetIds,
    status: "draft",
  });

  if (error) {
    return { error: error.message || "Failed to create broadcast draft." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function createScheduledBroadcast(
  data: CreateScheduledBroadcastInput
) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  const messageText = (data?.message_text ?? "").trim();
  if (!messageText) {
    return { error: "Message text is required." };
  }

  const validTargetTypes: TargetType[] = ["group", "tag", "manual"];
  if (!validTargetTypes.includes(data?.target_type)) {
    return { error: "Target type must be 'group', 'tag', or 'manual'." };
  }

  if (!Array.isArray(data?.target_ids) || data.target_ids.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  const normalizedTargetIds = data.target_ids
    .map((id) => String(id).trim())
    .filter(Boolean);

  if (normalizedTargetIds.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  if (!data?.scheduled_for) {
    return { error: "Scheduled date and time is required." };
  }

  const scheduledDate = new Date(data.scheduled_for);
  if (isNaN(scheduledDate.getTime())) {
    return { error: "Invalid scheduled date and time." };
  }

  if (scheduledDate.getTime() <= Date.now()) {
    return { error: "Scheduled time must be in the future." };
  }

  const { error } = await supabase.from("broadcasts").insert({
    message_text: messageText,
    target_type: data.target_type,
    target_ids: normalizedTargetIds,
    status: "scheduled",
    scheduled_for: scheduledDate.toISOString(),
  });

  if (error) {
    return { error: error.message || "Failed to create scheduled broadcast." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function updateBroadcast(id: string, data: UpdateBroadcastInput) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  if (!id) {
    return { error: "Broadcast ID is required." };
  }

  const messageText = (data?.message_text ?? "").trim();
  if (!messageText) {
    return { error: "Message text is required." };
  }

  const validTargetTypes: TargetType[] = ["group", "tag", "manual"];
  if (!validTargetTypes.includes(data?.target_type)) {
    return { error: "Target type must be 'group', 'tag', or 'manual'." };
  }

  if (!Array.isArray(data?.target_ids) || data.target_ids.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  const normalizedTargetIds = data.target_ids
    .map((item) => String(item).trim())
    .filter(Boolean);

  if (normalizedTargetIds.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  // Verify status is draft or scheduled
  const { data: existing, error: fetchError } = await supabase
    .from("broadcasts")
    .select("status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !existing) {
    return { error: "Broadcast not found." };
  }

  if (existing.status === "sent") {
    return { error: "Sent broadcasts cannot be edited." };
  }

  if (existing.status !== "draft" && existing.status !== "scheduled") {
    return { error: "Only draft or scheduled broadcasts can be edited." };
  }

  const updatePayload: {
    message_text: string;
    target_type: TargetType;
    target_ids: string[];
    scheduled_for?: string;
  } = {
    message_text: messageText,
    target_type: data.target_type,
    target_ids: normalizedTargetIds,
  };

  if (existing.status === "scheduled") {
    if (!data?.scheduled_for) {
      return { error: "Scheduled date and time is required." };
    }
    const scheduledDate = new Date(data.scheduled_for);
    if (isNaN(scheduledDate.getTime())) {
      return { error: "Invalid scheduled date and time." };
    }
    if (scheduledDate.getTime() <= Date.now()) {
      return { error: "Scheduled time must be in the future." };
    }
    updatePayload.scheduled_for = scheduledDate.toISOString();
  }

  const { error } = await supabase
    .from("broadcasts")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    return { error: error.message || "Failed to update broadcast." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function deleteBroadcast(id: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  if (!id) {
    return { error: "Broadcast ID is required." };
  }

  const { error } = await supabase
    .from("broadcasts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { error: error.message || "Failed to delete broadcast." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function deleteBroadcasts(ids: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  const broadcastIds = [...new Set(ids.filter(Boolean))];
  if (!broadcastIds.length) {
    return { error: "No broadcasts were selected." };
  }

  const { error } = await supabase
    .from("broadcasts")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", broadcastIds);

  if (error) {
    return { error: error.message || "Failed to delete broadcasts." };
  }

  revalidatePath("/broadcasts");
  return { success: true, deleted: broadcastIds.length };
}

export interface BroadcastSendResult {
  contactId: string;
  name: string;
  phone: string;
  success: boolean;
  error?: string;
}

export async function sendBroadcastNow(broadcastId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  if (!broadcastId) {
    return { error: "Broadcast ID is required." };
  }

  // 1. Fetch broadcast row
  const { data: broadcast, error: fetchError } = await supabase
    .from("broadcasts")
    .select("id, message_text, target_type, target_ids, status")
    .eq("id", broadcastId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !broadcast) {
    return { error: "Broadcast not found." };
  }

  // 2. Resolve target contacts
  let targetContacts: Array<{ id: string; name: string; phone: string }> = [];

  if (broadcast.target_type === "manual") {
    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id, name, phone")
      .in("id", broadcast.target_ids)
      .is("deleted_at", null);

    if (contactsError) {
      return { error: "Failed to resolve manual contacts." };
    }
    targetContacts = contacts ?? [];
  } else if (broadcast.target_type === "group") {
    const { data: relations, error: groupError } = await supabase
      .from("contact_groups")
      .select("contact_id, contacts(id, name, phone, deleted_at)")
      .in("group_id", broadcast.target_ids);

    if (groupError) {
      return { error: "Failed to resolve group contacts." };
    }

    const contactMap = new Map<string, { id: string; name: string; phone: string }>();
    for (const rel of relations ?? []) {
      const c = rel.contacts as unknown as {
        id: string;
        name: string;
        phone: string;
        deleted_at: string | null;
      } | null;
      if (c && !c.deleted_at && !contactMap.has(c.id)) {
        contactMap.set(c.id, { id: c.id, name: c.name, phone: c.phone });
      }
    }
    targetContacts = Array.from(contactMap.values());
  } else if (broadcast.target_type === "tag") {
    const { data: contacts, error: tagError } = await supabase
      .from("contacts")
      .select("id, name, phone")
      .overlaps("tags", broadcast.target_ids)
      .is("deleted_at", null);

    if (tagError) {
      return { error: "Failed to resolve tagged contacts." };
    }
    targetContacts = contacts ?? [];
  }

  if (targetContacts.length === 0) {
    return { error: "No active recipient contacts found for this target." };
  }

  // 3. Dispatch WhatsApp messages to each contact
  const results: BroadcastSendResult[] = [];

  for (const contact of targetContacts) {
    const normalizedPhone = normalizePhoneForWhatsApp(contact.phone);
    if (!normalizedPhone) {
      results.push({
        contactId: contact.id,
        name: contact.name,
        phone: contact.phone,
        success: false,
        error: "Invalid phone number format",
      });
      continue;
    }

    try {
      await sendWhatsAppMessage({
        to: normalizedPhone,
        message: broadcast.message_text,
      });
      results.push({
        contactId: contact.id,
        name: contact.name,
        phone: normalizedPhone,
        success: true,
      });
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "Failed to send message";
      results.push({
        contactId: contact.id,
        name: contact.name,
        phone: normalizedPhone,
        success: false,
        error: errMsg,
      });
    }
  }

  const sentCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  // 4. Update broadcast row status and timestamp
  await supabase
    .from("broadcasts")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", broadcastId);

  revalidatePath("/broadcasts");

  return {
    success: true,
    total: results.length,
    sentCount,
    failedCount,
    results,
  };
}

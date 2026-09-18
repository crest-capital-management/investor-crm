"use server";

import { requireActionAuth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { WhatsAppMessage } from "@/components/whatsapp-history";
import { generateChatSummary } from "@/lib/gemini";

const DUPLICATE_PHONE_ERROR =
  "This phone number is already associated with another contact.";

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string) {
  return EMAIL_REGEX.test(value);
}

export async function addContact(formData: FormData) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const name = formData.get("name") as string;
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const emailRaw = String(formData.get("email") ?? "").trim();
  const tagsRaw = formData.get("tags") as string;
  const dateSaved = formData.get("dateSaved") as string;

  let tags: string[] = [];
  try {
    tags = tagsRaw ? JSON.parse(tagsRaw) : [];
  } catch {
    tags = [];
  }

  if (!name || !phone) {
    return { error: "Name and phone are required." };
  }

  if (!/^\d{7,15}$/.test(phone)) {
    return { error: "Phone must contain 7-15 digits." };
  }

  if (!emailRaw) {
    return { error: "Email is required." };
  }
  if (!isValidEmail(emailRaw)) {
    return { error: "Please enter a valid email address." };
  }
  const normalizedEmail = emailRaw.toLowerCase();

  if (dateSaved && !isValidDate(dateSaved)) {
    return { error: "Date must use a valid YYYY-MM-DD date." };
  }

  const { data: existingContacts, error: lookupError } = await supabase
    .from("contacts")
    .select("phone")
    .is("deleted_at", null)
    .limit(10000);

  if (lookupError) {
    return { error: "The contact could not be checked for duplicates." };
  }

  if (
    existingContacts?.some(
      (contact) => normalizePhone(String(contact.phone)) === phone
    )
  ) {
    return { error: DUPLICATE_PHONE_ERROR };
  }

  const { error } = await supabase
    .from("contacts")
    .insert({
      name,
      phone,
      email: normalizedEmail,
      tags,
      date_saved: dateSaved || null,
    });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/contacts");
  return { success: true };
}

export async function updateContact(id: string, formData: FormData) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const emailRaw = String(formData.get("email") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "");
  const dateSaved = String(formData.get("dateSaved") ?? "").trim();

  let tags: string[] = [];
  try {
    const parsedTags: unknown = tagsRaw ? JSON.parse(tagsRaw) : [];
    tags = Array.isArray(parsedTags)
      ? parsedTags.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return { error: "Tags could not be processed." };
  }

  if (!name || !phone) {
    return { error: "Name and phone are required." };
  }

  if (!/^\d{7,15}$/.test(phone)) {
    return { error: "Phone must contain 7-15 digits." };
  }

  if (!emailRaw) {
    return { error: "Email is required." };
  }
  if (!isValidEmail(emailRaw)) {
    return { error: "Please enter a valid email address." };
  }
  const normalizedEmail = emailRaw.toLowerCase();

  if (dateSaved && !isValidDate(dateSaved)) {
    return { error: "Date must use a valid YYYY-MM-DD date." };
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from("contacts")
    .select("id")
    .eq("phone", phone)
    .neq("id", id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    return { error: "The contact could not be checked for duplicates." };
  }

  if (duplicate) {
    return { error: DUPLICATE_PHONE_ERROR };
  }

  const { data: otherContacts, error: normalizedLookupError } = await supabase
    .from("contacts")
    .select("id, phone")
    .neq("id", id)
    .is("deleted_at", null)
    .limit(10000);

  if (normalizedLookupError) {
    return { error: "The contact could not be checked for duplicates." };
  }

  if (
    otherContacts?.some(
      (contact) => normalizePhone(String(contact.phone)) === phone
    )
  ) {
    return { error: DUPLICATE_PHONE_ERROR };
  }

  const { error } = await supabase
    .from("contacts")
    .update({
      name,
      phone,
      email: normalizedEmail,
      tags,
      date_saved: dateSaved || null,
    })
    .eq("id", id);

  if (error) {
    return { error: "The contact could not be updated." };
  }

  revalidatePath("/contacts");
  return { success: true };
}

const CONTACT_TAG_OPTIONS = ["Investor", "Alumni", "Prospect", "Partner", "Advisor"];

export async function addTagToContact(id: string, tag: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedTag = tag.trim();
  if (!id.trim()) return { error: "The contact could not be found." };
  if (!CONTACT_TAG_OPTIONS.includes(normalizedTag)) return { error: "That tag is not available." };

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tags")
    .eq("id", id)
    .maybeSingle();

  if (contactError || !contact) return { error: "The contact could not be found." };

  const tags = Array.isArray(contact.tags) ? contact.tags.filter((value): value is string => typeof value === "string") : [];
  if (tags.some((value) => value.toLowerCase() === normalizedTag.toLowerCase())) {
    return { error: "That tag is already assigned to this contact." };
  }

  const updatedTags = [...tags, normalizedTag];
  const { error } = await supabase.from("contacts").update({ tags: updatedTags }).eq("id", id);
  if (error) return { error: "The tag could not be added." };

  revalidatePath("/contacts");
  return { success: true, tags: updatedTags };
}

export async function addMeetingNote(contactId: string, note: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  const normalizedNote = note.trim();

  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!normalizedNote) return { error: "Meeting note is required." };

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The contact could not be found." };

  const { error } = await supabase.from("interactions").insert({
    contact_id: normalizedContactId,
    type: "meeting",
    note: normalizedNote,
  });

  if (error) return { error: "The meeting note could not be saved." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export type MeetingNote = {
  id: string;
  note: string;
  created_at: string;
};

export async function getMeetingNotes(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  const { data: notes, error } = await supabase
    .from("interactions")
    .select("id, note, created_at")
    .eq("contact_id", normalizedContactId)
    .eq("type", "meeting")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return { error: "Meeting notes could not be loaded." };

  return { notes: (notes ?? []) as MeetingNote[] };
}

export async function getWhatsAppMessages(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  const { data: messages, error } = await supabase
    .from("whatsapp_messages")
    .select("id, direction, message_text, media_url, sent_at, created_at")
    .eq("contact_id", normalizedContactId)
    .is("deleted_at", null)
    .order("sent_at", { ascending: true });

  if (error) return { error: "WhatsApp messages could not be loaded." };

  return { messages: (messages ?? []) as WhatsAppMessage[] };
}

export async function updateMeetingNote(
  noteId: string,
  contactId: string,
  note: string,
) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedNoteId = noteId.trim();
  const normalizedContactId = contactId.trim();
  const normalizedNote = note.trim();

  if (!normalizedNoteId) return { error: "Invalid note ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!normalizedNote) return { error: "Meeting note is required." };

  // Verify contact exists
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The contact could not be found." };

  // Verify interaction exists, belongs to contact, and is strictly of type 'meeting'
  const { data: interaction, error: interactionError } = await supabase
    .from("interactions")
    .select("id, contact_id, type")
    .eq("id", normalizedNoteId)
    .maybeSingle();

  if (interactionError || !interaction) return { error: "Meeting note not found." };
  if (interaction.contact_id !== normalizedContactId) {
    return { error: "Meeting note does not belong to this contact." };
  }
  if (interaction.type !== "meeting") {
    return { error: "Only meeting notes can be edited." };
  }

  // Update only the note text. Preserves created_at, contact_id, type, id.
  const { error: updateError } = await supabase
    .from("interactions")
    .update({ note: normalizedNote })
    .eq("id", normalizedNoteId)
    .eq("contact_id", normalizedContactId)
    .eq("type", "meeting");

  if (updateError) return { error: "The meeting note could not be updated." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export async function deleteMeetingNote(noteId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedNoteId = noteId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedNoteId) return { error: "Invalid note ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };

  // Verify contact exists
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (contactError || !contact) return { error: "The contact could not be found." };

  // Verify interaction exists, belongs to contact, and is strictly of type 'meeting'
  const { data: interaction, error: interactionError } = await supabase
    .from("interactions")
    .select("id, contact_id, type")
    .eq("id", normalizedNoteId)
    .maybeSingle();

  if (interactionError || !interaction) return { error: "Meeting note not found." };
  if (interaction.contact_id !== normalizedContactId) {
    return { error: "Meeting note does not belong to this contact." };
  }
  if (interaction.type !== "meeting") {
    return { error: "Only meeting notes can be deleted." };
  }

  // Strictly soft-delete where id = noteId, contact_id = contactId, and type = 'meeting'
  // NEVER allow deleting type = 'follow_up'
  const { error: deleteError } = await supabase
    .from("interactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", normalizedNoteId)
    .eq("contact_id", normalizedContactId)
    .eq("type", "meeting");

  if (deleteError) return { error: "The meeting note could not be deleted." };

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export type ContactGroupOption = { id: string; name: string };

export async function getContactGroupOptions(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  if (!contactId.trim()) return { error: "The contact could not be found." };

  const [{ data: contact, error: contactError }, { data: groups, error: groupsError }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase.from("contacts").select("id").eq("id", contactId).maybeSingle(),
    supabase.from("groups").select("id, name").order("name", { ascending: true }),
    supabase.from("contact_groups").select("group_id").eq("contact_id", contactId),
  ]);

  if (contactError || !contact) return { error: "The contact could not be found." };
  if (groupsError || membershipsError) return { error: "Groups could not be loaded." };

  const memberIds = new Set((memberships ?? []).map((membership) => membership.group_id));
  return {
    groups: (groups ?? []).filter((group) => !memberIds.has(group.id)) as ContactGroupOption[],
  };
}

export async function addContactToGroups(contactId: string, groupIds: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedGroupIds = [...new Set(groupIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!contactId.trim()) return { error: "The contact could not be found." };
  if (!normalizedGroupIds.length) return { error: "No groups were selected." };

  const [{ data: contact, error: contactError }, { data: groups, error: groupsError }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase.from("contacts").select("id").eq("id", contactId).maybeSingle(),
    supabase.from("groups").select("id, name").in("id", normalizedGroupIds),
    supabase.from("contact_groups").select("group_id").eq("contact_id", contactId).in("group_id", normalizedGroupIds),
  ]);

  if (contactError || !contact) return { error: "The contact could not be found." };
  if (groupsError || groups?.length !== normalizedGroupIds.length) return { error: "One or more selected groups could not be found." };
  if (membershipsError) return { error: "Group memberships could not be checked." };

  const existingIds = new Set((memberships ?? []).map((membership) => membership.group_id));
  const newGroupIds = normalizedGroupIds.filter((id) => !existingIds.has(id));
  if (newGroupIds.length) {
    const { error } = await supabase.from("contact_groups").insert(newGroupIds.map((groupId) => ({ contact_id: contactId, group_id: groupId })));
    if (error) return { error: "The contact could not be added to the groups." };
  }

  const { data: updatedMemberships, error: updatedMembershipsError } = await supabase
    .from("contact_groups")
    .select("groups(id, name)")
    .eq("contact_id", contactId);
  if (updatedMembershipsError) return { error: "The contact groups could not be refreshed." };

  revalidatePath("/contacts");
  revalidatePath("/groups");
  return {
    success: true,
    added: newGroupIds.length,
    groups: updatedMemberships ?? [],
  };
}

export async function deleteContact(id: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { error: "The contact could not be deleted." };
  }

  revalidatePath("/contacts");
  return { success: true };
}

export async function deleteContacts(ids: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const contactIds = [...new Set(ids.filter(Boolean))];

  if (!contactIds.length) {
    return { error: "No contacts were selected." };
  }
  const { error: relationError } = await supabase
    .from("contact_groups")
    .delete()
    .in("contact_id", contactIds);

  if (relationError) {
    return { error: "The selected contacts could not be deleted." };
  }

  const { error } = await supabase
    .from("contacts")
    .delete()
    .in("id", contactIds);

  if (error) {
    return { error: "The selected contacts could not be deleted." };
  }

  revalidatePath("/contacts");
  return { success: true, deleted: contactIds.length };
}

export type ImportContactRow = {
  name: string;
  phone: string;
  email?: string | null;
  tag: string;
  dateSaved: string;
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

function validateImportRow(row: ImportContactRow) {
  if (!row.name || !row.phone || !row.email) {
    return "Name, phone, and email are required.";
  }

  if (!/^\d{7,15}$/.test(row.phone)) {
    return "Phone must contain 7-15 digits.";
  }

  if (!isValidEmail(row.email)) {
    return "Please enter a valid email address.";
  }

  if (row.dateSaved && !isValidDate(row.dateSaved)) {
    return "Date Saved must use a valid YYYY-MM-DD date.";
  }

  return null;
}

export async function importContacts(rowsRaw: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  let rows: ImportContactRow[];

  try {
    const parsedRows: unknown = JSON.parse(rowsRaw);
    if (!Array.isArray(parsedRows)) throw new Error("Invalid rows");
    rows = parsedRows.map((row) => {
      const rowObj = row as ImportContactRow;
      const emailRaw = rowObj.email !== undefined && rowObj.email !== null
        ? String(rowObj.email).trim()
        : "";
      return {
        name: String(rowObj.name ?? "").trim(),
        phone: String(rowObj.phone ?? "").trim(),
        email: emailRaw || null,
        tag: String(rowObj.tag ?? "").trim(),
        dateSaved: String(rowObj.dateSaved ?? "").trim(),
      };
    });
  } catch {
    return { error: "The CSV data could not be processed." };
  }

  if (!rows.length) {
    return { error: "The CSV file does not contain any rows." };
  }

  const validRows = rows.filter((row) => !validateImportRow(row));
  const rejected = rows.length - validRows.length;

  const { data: existingContacts, error: lookupError } = await supabase
    .from("contacts")
    .select("phone")
    .limit(10000);

  if (lookupError) {
    return { error: "Contacts could not be checked for duplicates." };
  }

  const existingPhones = new Set(
    (existingContacts ?? []).map((contact) =>
      normalizePhone(String(contact.phone))
    )
  );
  const seenPhones = new Set<string>();
  const rowsToInsert = validRows.filter((row) => {
    const normalizedPhone = normalizePhone(row.phone);
    if (existingPhones.has(normalizedPhone) || seenPhones.has(normalizedPhone)) {
      return false;
    }
    seenPhones.add(normalizedPhone);
    return true;
  });

  const duplicates = validRows.length - rowsToInsert.length;

  if (rowsToInsert.length) {
    const { error: insertError } = await supabase.from("contacts").insert(
      rowsToInsert.map((row) => ({
        name: row.name,
        phone: normalizePhone(row.phone),
        email: row.email ? row.email.toLowerCase() : null,
        tags: row.tag ? [row.tag] : [],
        date_saved: row.dateSaved || null,
      }))
    );

    if (insertError) {
      return { error: "Contacts could not be imported." };
    }
  }

  revalidatePath("/contacts");
  return {
    success: true,
    imported: rowsToInsert.length,
    duplicates,
    rejected,
  };
}

export type GenerateWhatsAppSummaryResult =
  | {
      success: true;
      summary: string;
      generatedAt: string;
    }
  | {
      error: string;
    };

export async function generateWhatsAppSummary(
  contactId: string
): Promise<GenerateWhatsAppSummaryResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  try {
    const { data: messages, error: messagesError } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, message_text, media_url, sent_at, created_at")
      .eq("contact_id", normalizedContactId)
      .is("deleted_at", null)
      .order("sent_at", { ascending: true });

    if (messagesError) {
      return { error: "WhatsApp messages could not be loaded." };
    }

    if (!messages || messages.length === 0) {
      return { error: "No WhatsApp messages found to summarize." };
    }

    const summary = await generateChatSummary(messages);
    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("contacts")
      .update({
        whatsapp_summary: summary,
        whatsapp_summary_generated_at: nowIso,
      })
      .eq("id", normalizedContactId);

    if (updateError) {
      return { error: "Failed to save the WhatsApp summary." };
    }

    revalidatePath(`/contacts/${normalizedContactId}`);
    revalidatePath(`/investors/${normalizedContactId}`);

    return {
      success: true,
      summary,
      generatedAt: nowIso,
    };
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error ? err.message : "Failed to generate WhatsApp summary.";
    return { error: errMsg };
  }
}

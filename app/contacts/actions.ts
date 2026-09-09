"use server";

import { createClient } from "@/src/lib/supabase/server";
import { revalidatePath } from "next/cache";

const DUPLICATE_PHONE_ERROR =
  "This phone number is already associated with another contact.";

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export async function addContact(formData: FormData) {
  const name = formData.get("name") as string;
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
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

  if (!dateSaved) {
    return { error: "Date is required." };
  }

  const supabase = await createClient();
  const { data: existingContacts, error: lookupError } = await supabase
    .from("contacts")
    .select("phone")
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
    .insert({ name, phone, tags, date_saved: dateSaved });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/contacts");
  return { success: true };
}

export async function updateContact(id: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
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

  if (!isValidDate(dateSaved)) {
    return { error: "Date must use a valid YYYY-MM-DD date." };
  }

  const supabase = await createClient();
  const { data: duplicate, error: duplicateError } = await supabase
    .from("contacts")
    .select("id")
    .eq("phone", phone)
    .neq("id", id)
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
    .update({ name, phone, tags, date_saved: dateSaved })
    .eq("id", id);

  if (error) {
    return { error: "The contact could not be updated." };
  }

  revalidatePath("/contacts");
  return { success: true };
}

export async function deleteContact(id: string) {
  const supabase = await createClient();
  const { error: relationError } = await supabase
    .from("contact_groups")
    .delete()
    .eq("contact_id", id);

  if (relationError) {
    return { error: "The contact could not be deleted." };
  }

  const { error } = await supabase.from("contacts").delete().eq("id", id);

  if (error) {
    return { error: "The contact could not be deleted." };
  }

  revalidatePath("/contacts");
  return { success: true };
}

export async function deleteContacts(ids: string[]) {
  const contactIds = [...new Set(ids.filter(Boolean))];

  if (!contactIds.length) {
    return { error: "No contacts were selected." };
  }

  const supabase = await createClient();
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
  if (!row.name || !row.phone || !row.dateSaved) {
    return "Name, phone, and date saved are required.";
  }

  if (!/^\d{7,15}$/.test(row.phone)) {
    return "Phone must contain 7-15 digits.";
  }

  if (!isValidDate(row.dateSaved)) {
    return "Date Saved must use a valid YYYY-MM-DD date.";
  }

  return null;
}

export async function importContacts(rowsRaw: string) {
  let rows: ImportContactRow[];

  try {
    const parsedRows: unknown = JSON.parse(rowsRaw);
    if (!Array.isArray(parsedRows)) throw new Error("Invalid rows");
    rows = parsedRows.map((row) => ({
      name: String((row as ImportContactRow).name ?? "").trim(),
      phone: String((row as ImportContactRow).phone ?? "").trim(),
      tag: String((row as ImportContactRow).tag ?? "").trim(),
      dateSaved: String((row as ImportContactRow).dateSaved ?? "").trim(),
    }));
  } catch {
    return { error: "The CSV data could not be processed." };
  }

  if (!rows.length) {
    return { error: "The CSV file does not contain any rows." };
  }

  const validRows = rows.filter((row) => !validateImportRow(row));
  const rejected = rows.length - validRows.length;

  const supabase = await createClient();
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
        tags: row.tag ? [row.tag] : [],
        date_saved: row.dateSaved,
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

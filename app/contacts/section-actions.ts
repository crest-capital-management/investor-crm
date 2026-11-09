"use server";

import { revalidatePath } from "next/cache";

import { requireActionAuth } from "@/lib/auth";
import { db, isMissingSchemaError, isUniqueViolation } from "@/lib/db";
import { isUuid } from "@/lib/validate";

const MAX_NAME_LENGTH = 40;
const MAX_CONTACTS = 5000;
const NOT_SET_UP =
  "Sections are not set up in the database yet (azure/003_contact_sections.sql has not been applied).";

type Result = { success: true } | { error: string };

function refresh() {
  revalidatePath("/contacts");
  revalidatePath("/investors");
}

function cleanName(name: string): string | { error: string } {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return { error: "Please enter a name." };
  if (trimmed.length > MAX_NAME_LENGTH) return { error: `Please keep the name under ${MAX_NAME_LENGTH} characters.` };
  return trimmed;
}

function failure(err: unknown, fallback: string): { error: string } {
  if (isMissingSchemaError(err)) return { error: NOT_SET_UP };
  if (isUniqueViolation(err)) return { error: "A section with that name already exists." };
  console.error("[sections]", err instanceof Error ? err.message : err);
  return { error: fallback };
}

/** Adds a section at the end of the tab row. */
export async function createSection(name: string): Promise<Result> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  const clean = cleanName(name);
  if (typeof clean !== "string") return clean;

  try {
    await db.execute(
      `insert into public.contact_sections (name, sort_order)
       select $1, coalesce(max(sort_order), 0) + 1 from public.contact_sections`,
      [clean],
    );
  } catch (err) {
    return failure(err, "The section could not be added.");
  }
  refresh();
  return { success: true };
}

export async function renameSection(id: string, name: string): Promise<Result> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (!isUuid(id)) return { error: "Unknown section." };
  const clean = cleanName(name);
  if (typeof clean !== "string") return clean;

  try {
    const changed = await db.execute("update public.contact_sections set name = $2 where id = $1", [id, clean]);
    if (changed === 0) return { error: "That section no longer exists." };
  } catch (err) {
    return failure(err, "The section could not be renamed.");
  }
  refresh();
  return { success: true };
}

/** Deletes a section that has no contacts (deleted contacts are moved to "no section"). */
export async function deleteSection(id: string): Promise<Result> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (!isUuid(id)) return { error: "Unknown section." };

  try {
    const result = await db.tx(async (tx) => {
      const { count } = await tx.one<{ count: number }>(
        "select count(*)::int as count from public.contacts where section_id = $1 and deleted_at is null",
        [id],
      );
      if (count > 0) {
        return { error: `This section still has ${count} contact${count === 1 ? "" : "s"}. Move them to another section first.` };
      }
      // Contacts deleted earlier may still point at it.
      await tx.execute("update public.contacts set section_id = null where section_id = $1", [id]);
      const deleted = await tx.execute("delete from public.contact_sections where id = $1", [id]);
      return deleted === 0 ? { error: "That section no longer exists." } : null;
    });
    if (result) return result;
  } catch (err) {
    return failure(err, "The section could not be deleted.");
  }
  refresh();
  return { success: true };
}

/** Puts contacts into a section (sectionId null = no section). */
export async function moveContactsToSection(
  contactIds: string[],
  sectionId: string | null,
): Promise<{ success: true; updated: number } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (sectionId !== null && !isUuid(sectionId)) return { error: "Unknown section." };

  const ids = [...new Set(contactIds.map((id) => String(id).trim()).filter((id) => isUuid(id)))];
  if (ids.length === 0) return { error: "No contacts were selected." };
  if (ids.length > MAX_CONTACTS) return { error: `Please select at most ${MAX_CONTACTS} contacts at a time.` };

  let updated: number;
  try {
    if (sectionId) {
      const exists = await db.maybeOne("select 1 from public.contact_sections where id = $1", [sectionId]);
      if (!exists) return { error: "That section no longer exists." };
    }
    updated = await db.execute(
      "update public.contacts set section_id = $2 where id = any($1::uuid[]) and deleted_at is null",
      [ids, sectionId],
    );
  } catch (err) {
    return failure(err, "The contacts could not be moved.");
  }
  refresh();
  return { success: true, updated };
}

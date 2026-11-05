"use server";

import { revalidatePath } from "next/cache";

import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  normalizeGroupMembers,
  type GroupContactRelation,
} from "@/lib/group-members";
import { escapeLike, ilikeAny } from "@/lib/sql";

function validateName(value: string) {
  const name = value.trim();
  if (!name) return "Group name is required.";
  if (name.length > 100) return "Group name must be 100 characters or fewer.";
  return null;
}

async function hasDuplicateName(name: string, excludeId?: string) {
  try {
    const row = await db.maybeOne<{ id: string }>(
      `select id from public.groups
       where name ilike $1 and ($2::uuid is null or id <> $2::uuid)
       limit 1`,
      [escapeLike(name), excludeId ?? null],
    );
    return { duplicate: Boolean(row), error: null };
  } catch (error) {
    return { duplicate: false, error };
  }
}

const EMPTY_GROUP_ERROR = "A group must have at least one member.";

async function countActiveMembers(groupId: string) {
  try {
    const row = await db.one<{ count: number }>(
      `select count(*)::int as count
       from public.contact_groups cg
       join public.contacts c on c.id = cg.contact_id
       where cg.group_id = $1 and c.deleted_at is null`,
      [groupId],
    );
    return { count: row.count, error: null };
  } catch (error) {
    return { count: 0, error };
  }
}

async function groupExists(groupId: string) {
  const row = await db.maybeOne<{ id: string }>(`select id from public.groups where id = $1`, [groupId]);
  return Boolean(row);
}

export async function addGroup(name: string, contactIds: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const trimmedName = String(name ?? "").trim();
  const validationError = validateName(trimmedName);
  if (validationError) return { error: validationError };

  const normalizedContactIds = [
    ...new Set((contactIds ?? []).filter((id) => typeof id === "string" && id.trim())),
  ];
  if (!normalizedContactIds.length) {
    return { error: `${EMPTY_GROUP_ERROR} Select at least one contact.` };
  }

  const duplicateCheck = await hasDuplicateName(trimmedName);
  if (duplicateCheck.error) return { error: "The group could not be checked for duplicates." };
  if (duplicateCheck.duplicate) return { error: "A group with this name already exists." };

  // Check the contacts exist before creating anything, so a stale selection
  // never leaves a half-made group behind.
  try {
    const found = await db.query<{ id: string }>(
      `select id from public.contacts where deleted_at is null and id = any($1::uuid[])`,
      [normalizedContactIds],
    );
    if (new Set(found.map((contact) => contact.id)).size !== normalizedContactIds.length) {
      return { error: "One or more selected contacts could not be found." };
    }
  } catch {
    return { error: "The selected contacts could not be checked." };
  }

  // The group and its members are saved together, so an empty or partial group is never left behind.
  try {
    await db.tx(async (tx) => {
      const group = await tx.one<{ id: string }>(
        `insert into public.groups (name) values ($1) returning id`,
        [trimmedName],
      );
      await tx.execute(
        `insert into public.contact_groups (contact_id, group_id)
         select unnest($1::uuid[]), $2::uuid`,
        [normalizedContactIds, group.id],
      );
    });
  } catch {
    return { error: "The group could not be created with those contacts." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return { success: true };
}

export async function updateGroup(id: string, formData: FormData) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const name = String(formData.get("name") ?? "").trim();
  const validationError = validateName(name);
  if (validationError) return { error: validationError };

  const duplicateCheck = await hasDuplicateName(name, id);
  if (duplicateCheck.error) return { error: "The group could not be checked for duplicates." };
  if (duplicateCheck.duplicate) return { error: "A group with this name already exists." };

  try {
    await db.execute(`update public.groups set name = $1 where id = $2`, [name, id]);
  } catch {
    return { error: "The group could not be updated." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return { success: true };
}

export async function deleteGroup(id: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  try {
    await db.tx(async (tx) => {
      await tx.execute(`delete from public.contact_groups where group_id = $1`, [id]);
      await tx.execute(`delete from public.groups where id = $1`, [id]);
    });
  } catch {
    return { error: "The group could not be deleted." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return { success: true };
}

export async function removeContactFromGroup(groupId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  if (!groupId.trim() || !contactId.trim()) {
    return { error: "The group membership could not be found." };
  }

  try {
    const [group, contact] = await Promise.all([
      db.maybeOne<{ id: string }>(`select id from public.groups where id = $1`, [groupId]),
      db.maybeOne<{ id: string }>(`select id from public.contacts where id = $1`, [contactId]),
    ]);
    if (!group || !contact) return { error: "The group membership could not be found." };
  } catch {
    return { error: "The group membership could not be found." };
  }

  try {
    const membership = await db.maybeOne<{ contact_id: string }>(
      `select contact_id from public.contact_groups where group_id = $1 and contact_id = $2`,
      [groupId, contactId],
    );
    if (!membership) return { error: "This contact is not in the group." };
  } catch {
    return { error: "The group membership could not be checked." };
  }

  const members = await countActiveMembers(groupId);
  if (members.error) return { error: "The group members could not be counted." };
  if (members.count <= 1) {
    return {
      error: `${EMPTY_GROUP_ERROR} Add another contact first, or delete the group.`,
    };
  }

  try {
    await db.execute(
      `delete from public.contact_groups where group_id = $1 and contact_id = $2`,
      [groupId, contactId],
    );
  } catch {
    return { error: "The contact could not be removed from the group." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return { success: true };
}

export async function removeContactsFromGroup(groupId: string, contactIds: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactIds = [
    ...new Set(contactIds.filter((id) => typeof id === "string" && id.trim())),
  ];

  if (!groupId.trim()) return { error: "The group could not be found." };
  if (!normalizedContactIds.length) return { error: "No contacts were selected." };

  try {
    if (!(await groupExists(groupId))) return { error: "The group could not be found." };
  } catch {
    return { error: "The group could not be found." };
  }

  try {
    const contacts = await db.query<{ id: string }>(
      `select id from public.contacts where id = any($1::uuid[])`,
      [normalizedContactIds],
    );
    if (contacts.length !== normalizedContactIds.length) {
      return { error: "One or more selected contacts could not be found." };
    }
  } catch {
    return { error: "One or more selected contacts could not be found." };
  }

  let memberIds: string[];
  try {
    const memberships = await db.query<{ contact_id: string }>(
      `select contact_id from public.contact_groups
       where group_id = $1 and contact_id = any($2::uuid[])`,
      [groupId, normalizedContactIds],
    );
    memberIds = [...new Set(memberships.map((membership) => membership.contact_id))];
  } catch {
    return { error: "The group memberships could not be checked." };
  }
  if (!memberIds.length) return { error: "The selected contacts are not in this group." };

  const members = await countActiveMembers(groupId);
  if (members.error) return { error: "The group members could not be counted." };
  if (members.count - memberIds.length < 1) {
    return {
      error: `${EMPTY_GROUP_ERROR} Keep at least one contact, or delete the group.`,
    };
  }

  try {
    await db.execute(
      `delete from public.contact_groups where group_id = $1 and contact_id = any($2::uuid[])`,
      [groupId, memberIds],
    );
  } catch {
    return { error: "The contacts could not be removed from the group." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return { success: true, removed: memberIds.length };
}

export async function deleteGroups(ids: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const groupIds = [
    ...new Set(ids.filter((id) => typeof id === "string" && id.trim())),
  ];

  if (!groupIds.length) {
    return { error: "No groups were selected." };
  }

  try {
    const existingGroups = await db.query<{ id: string }>(
      `select id from public.groups where id = any($1::uuid[])`,
      [groupIds],
    );
    if (existingGroups.length !== groupIds.length) {
      return { error: "The selected groups could not be found." };
    }
  } catch {
    return { error: "The selected groups could not be found." };
  }

  try {
    await db.tx(async (tx) => {
      await tx.execute(`delete from public.contact_groups where group_id = any($1::uuid[])`, [groupIds]);
      await tx.execute(`delete from public.groups where id = any($1::uuid[])`, [groupIds]);
    });
  } catch {
    return { error: "The selected groups could not be deleted." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return { success: true, deleted: groupIds.length };
}

export type GroupContactOption = {
  id: string;
  name: string;
  phone: string;
};

export async function getGroupContactOptions(groupId: string, search = "") {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  if (!groupId.trim()) return { error: "The group could not be found." };

  try {
    if (!(await groupExists(groupId))) return { error: "The group could not be found." };
  } catch {
    return { error: "The group could not be found." };
  }

  let memberships: { contact_id: string }[];
  try {
    memberships = await db.query<{ contact_id: string }>(
      `select contact_id from public.contact_groups where group_id = $1`,
      [groupId],
    );
  } catch {
    return { error: "Contacts could not be loaded." };
  }

  const trimmedSearch = search.trim();

  let contacts: GroupContactOption[];
  try {
    const params: unknown[] = [];
    const where = ["deleted_at is null"];
    if (trimmedSearch) where.push(ilikeAny(["name", "phone"], trimmedSearch, params));
    contacts = await db.query<GroupContactOption>(
      `select id, name, phone from public.contacts
       where ${where.join(" and ")}
       order by name asc, id asc`,
      params,
    );
  } catch {
    return { error: "Contacts could not be loaded." };
  }

  const memberIds = new Set(memberships.map((membership) => membership.contact_id));
  return {
    contacts: contacts.filter((contact) => !memberIds.has(contact.id)),
    totalContacts: contacts.length,
  };
}

const NEW_GROUP_CONTACT_LIMIT = 100;

/**
 * Contacts to pick from when creating a group. Capped (and searchable) rather
 * than loading every contact, which keeps the sheet fast with thousands of rows.
 */
export async function searchContactsForNewGroup(search = "") {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const trimmedSearch = search.trim();

  let rows: GroupContactOption[];
  try {
    const params: unknown[] = [];
    const where = ["deleted_at is null"];
    if (trimmedSearch) where.push(ilikeAny(["name", "phone"], trimmedSearch, params));
    params.push(NEW_GROUP_CONTACT_LIMIT + 1);
    rows = await db.query<GroupContactOption>(
      `select id, name, phone from public.contacts
       where ${where.join(" and ")}
       order by name asc, id asc
       limit $${params.length}`,
      params,
    );
  } catch {
    return { error: "Contacts could not be loaded." };
  }

  return {
    contacts: rows.slice(0, NEW_GROUP_CONTACT_LIMIT),
    hasMore: rows.length > NEW_GROUP_CONTACT_LIMIT,
  };
}

export async function addContactsToGroup(groupId: string, contactIds: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactIds = [
    ...new Set(contactIds.filter((id) => typeof id === "string" && id.trim())),
  ];

  if (!groupId.trim()) return { error: "The group could not be found." };
  if (!normalizedContactIds.length) return { error: "No contacts were selected." };

  try {
    if (!(await groupExists(groupId))) return { error: "The group could not be found." };
  } catch {
    return { error: "The group could not be found." };
  }

  try {
    const contacts = await db.query<{ id: string }>(
      `select id from public.contacts where id = any($1::uuid[])`,
      [normalizedContactIds],
    );
    if (contacts.length !== normalizedContactIds.length) {
      return { error: "One or more selected contacts could not be found." };
    }
  } catch {
    return { error: "One or more selected contacts could not be found." };
  }

  let existingIds: Set<string>;
  try {
    const existingMemberships = await db.query<{ contact_id: string }>(
      `select contact_id from public.contact_groups
       where group_id = $1 and contact_id = any($2::uuid[])`,
      [groupId, normalizedContactIds],
    );
    existingIds = new Set(existingMemberships.map((membership) => membership.contact_id));
  } catch {
    return { error: "The group memberships could not be checked." };
  }

  const newContactIds = normalizedContactIds.filter((id) => !existingIds.has(id));

  if (newContactIds.length) {
    try {
      await db.execute(
        `insert into public.contact_groups (contact_id, group_id)
         select unnest($1::uuid[]), $2::uuid
         on conflict do nothing`,
        [newContactIds, groupId],
      );
    } catch {
      return { error: "The contacts could not be added to the group." };
    }
  }

  let relations: GroupContactRelation[];
  try {
    const updatedGroup = await db.maybeOne<{ contact_groups: GroupContactRelation[] }>(
      `select coalesce((
         select json_agg(json_build_object(
           'contact_id', cg.contact_id,
           'contacts', case when c.id is null then null
                            else json_build_object('id', c.id, 'name', c.name, 'phone', c.phone) end
         ))
         from public.contact_groups cg
         left join public.contacts c on c.id = cg.contact_id
         where cg.group_id = g.id
       ), '[]'::json) as contact_groups
       from public.groups g
       where g.id = $1`,
      [groupId],
    );
    if (!updatedGroup) return { error: "The group members could not be refreshed." };
    relations = updatedGroup.contact_groups;
  } catch {
    return { error: "The group members could not be refreshed." };
  }

  revalidatePath("/groups");
  revalidatePath("/contacts");
  return {
    success: true,
    added: newContactIds.length,
    already: existingIds.size,
    contactGroups: normalizeGroupMembers(relations),
  };
}

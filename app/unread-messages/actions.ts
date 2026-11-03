"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUnknownConversations } from "@/lib/unknown-numbers";

export async function getUnreadConversationCount(): Promise<number> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return 0;

  const [count, unknown] = await Promise.all([
    db
      .one<{ n: number }>("select count(*)::int as n from public.unread_conversations()")
      .then((row) => row.n)
      .catch(() => 0),
    getUnknownConversations(),
  ]);

  // Numbers that messaged but aren't saved as contacts count too.
  return count + unknown.length;
}

export async function markConversationRead(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  try {
    await db.execute("update contacts set last_read_at = $1 where id::text = $2", [
      new Date().toISOString(),
      normalizedContactId,
    ]);
  } catch {
    return { error: "The conversation could not be marked as read." };
  }

  revalidatePath("/unread-messages");
  return { success: true as const };
}

export async function markAllConversationsRead() {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  let contactIds: string[];
  try {
    const data = await db.query<{ contact_id: string }>("select contact_id from public.unread_conversations()");
    contactIds = data.map((row) => row.contact_id);
  } catch {
    return { error: "Unread conversations could not be loaded." };
  }
  if (contactIds.length === 0) return { success: true as const, marked: 0 };

  try {
    await db.execute("update contacts set last_read_at = $1 where id = any($2::uuid[])", [
      new Date().toISOString(),
      contactIds,
    ]);
  } catch {
    return { error: "Conversations could not be marked as read." };
  }

  revalidatePath("/unread-messages");
  return { success: true as const, marked: contactIds.length };
}

"use server";

import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getUnknownConversations } from "@/lib/unknown-numbers";

export type NotificationItem = {
  id: string;
  kind: "message" | "followup" | "broadcast";
  title: string;
  description: string;
  href: string;
  /** ISO timestamp used for the relative time label and ordering. */
  at: string;
  urgent?: boolean;
};

export type NotificationsResult = {
  items: NotificationItem[];
  /** Items that need action: unread conversations + follow-ups due or overdue. */
  badgeCount: number;
};

const MAX_PER_KIND = 10;

function truncate(value: string, max = 80) {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export async function getNotifications(): Promise<NotificationsResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { items: [], badgeCount: 0 };

  const settings = await getAppSettings();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  type UnreadRow = {
    contact_id: string;
    unread_count: number;
    last_message_at: string;
    last_message_text: string | null;
    last_media_url: string | null;
  };
  type FollowUpRow = { id: string; contact_id: string; due_date: string; message: string | null };
  type BroadcastRow = { id: string; message_text: string | null; sent_at: string | null };

  // Each list comes with its total (count(*) over ()); a failed or switched-off query counts as empty.
  const [unreadList, followUpList, broadcasts] = await Promise.all([
    settings.notifyMessages
      ? db
          .query<UnreadRow & { total: number }>(
            "select *, count(*) over () as total from public.unread_conversations() order by last_message_at desc limit $1",
            [MAX_PER_KIND],
          )
          .catch(() => [] as Array<UnreadRow & { total: number }>)
      : Promise.resolve([] as Array<UnreadRow & { total: number }>),
    settings.notifyFollowUps
      ? db
          .query<FollowUpRow & { total: number }>(
            `select id, contact_id, due_date, message, count(*) over () as total
               from follow_ups
              where is_done = false and deleted_at is null and due_date <= $1
              order by due_date asc, id asc
              limit $2`,
            [todayStr, MAX_PER_KIND],
          )
          .catch(() => [] as Array<FollowUpRow & { total: number }>)
      : Promise.resolve([] as Array<FollowUpRow & { total: number }>),
    settings.notifyBroadcasts
      ? db
          .query<BroadcastRow>(
            `select id, message_text, sent_at from broadcasts
              where status = 'sent' and deleted_at is null and sent_at >= $1
              order by sent_at desc
              limit $2`,
            [sevenDaysAgoIso, MAX_PER_KIND],
          )
          .catch(() => [] as BroadcastRow[])
      : Promise.resolve([] as BroadcastRow[]),
  ]);

  const unreadRows: UnreadRow[] = unreadList;
  const followUps: FollowUpRow[] = followUpList;

  const contactIds = [
    ...new Set([
      ...unreadRows.map((row) => row.contact_id),
      ...followUps.map((followUp) => followUp.contact_id),
    ]),
  ];

  const contactNames = new Map<string, string>();
  if (contactIds.length) {
    try {
      const contacts = await db.query<{ id: string; name: string }>(
        "select id, name from contacts where id = any($1::uuid[])",
        [contactIds],
      );
      for (const contact of contacts) {
        contactNames.set(contact.id, contact.name);
      }
    } catch {
      // Like before, a failed lookup leaves these items out.
    }
  }

  const items: NotificationItem[] = [];

  for (const row of unreadRows) {
    const name = contactNames.get(row.contact_id);
    if (!name) continue;
    const count = Number(row.unread_count);
    const preview =
      row.last_message_text?.trim() || (row.last_media_url ? "[Media message]" : "New message");
    items.push({
      id: `message-${row.contact_id}`,
      kind: "message",
      title: count > 1 ? `${name} sent ${count} messages` : `${name} sent a message`,
      description: truncate(preview),
      href: `/contacts/${row.contact_id}`,
      at: row.last_message_at,
    });
  }

  // Numbers that messaged but aren't saved as contacts.
  const unknown = settings.notifyMessages ? await getUnknownConversations() : [];
  for (const conversation of unknown.slice(0, MAX_PER_KIND)) {
    const who = conversation.profileName
      ? `${conversation.profileName} (${conversation.phone})`
      : conversation.phone;
    const preview =
      conversation.lastMessageText?.trim() ||
      (conversation.hasMedia ? "[Media message]" : "New message");
    items.push({
      id: `unknown-${conversation.phone}`,
      kind: "message",
      title: `Unsaved number ${who} sent ${
        conversation.messageCount > 1 ? `${conversation.messageCount} messages` : "a message"
      }`,
      description: truncate(preview),
      href: "/unread-messages",
      at: conversation.lastMessageAt,
    });
  }

  for (const followUp of followUps) {
    const name = contactNames.get(followUp.contact_id as string);
    if (!name) continue;
    const dueDate = followUp.due_date as string;
    const overdue = dueDate < todayStr;
    items.push({
      id: `followup-${followUp.id}`,
      kind: "followup",
      title: overdue ? `Overdue follow-up: ${name}` : `Follow-up due today: ${name}`,
      description: truncate((followUp.message as string | null) ?? "No details"),
      href: `/contacts/${followUp.contact_id}`,
      at: `${dueDate.slice(0, 10)}T00:00:00`,
      urgent: overdue,
    });
  }

  for (const broadcast of broadcasts) {
    if (!broadcast.sent_at) continue;
    items.push({
      id: `broadcast-${broadcast.id}`,
      kind: "broadcast",
      title: "Broadcast sent",
      description: truncate((broadcast.message_text as string | null) ?? ""),
      href: `/broadcasts/${broadcast.id}`,
      at: broadcast.sent_at as string,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    items,
    badgeCount: (unreadList[0]?.total ?? 0) + unknown.length + (followUpList[0]?.total ?? 0),
  };
}

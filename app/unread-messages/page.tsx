import type { Metadata } from "next";
import { requireAuthFast } from "@/lib/auth";
import { db } from "@/lib/db";
import { PaginationControls } from "@/components/pagination-controls";
import {
  UnreadMessagesList,
  type UnreadConversation,
} from "@/components/unread-messages-list";
import { getPageRange, getTotalPages, parsePage } from "@/lib/pagination";
import { getUnknownConversations } from "@/lib/unknown-numbers";
import { UnknownNumbersList } from "@/components/unknown-numbers-list";

export const metadata: Metadata = {
  title: "Unread Messages",
};

type UnreadRpcRow = {
  contact_id: string;
  unread_count: number;
  last_message_at: string;
  last_message_text: string | null;
  last_media_url: string | null;
};

export default async function UnreadMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const requestedPage = parsePage((await searchParams).page);
  await requireAuthFast();

  let count = 0;
  let countFailed = false;
  try {
    count = (await db.one<{ n: number }>("select count(*)::int as n from public.unread_conversations()")).n;
  } catch {
    countFailed = true;
  }

  if (countFailed) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Unread Messages</h1>
        <p className="mt-2 text-destructive">
          Unable to load unread messages. Please refresh the page or try again in a minute.
        </p>
      </div>
    );
  }

  const totalCount = count ?? 0;
  // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
  const page = Math.min(requestedPage, getTotalPages(totalCount));
  const { from, to } = getPageRange(page);

  let rows: UnreadRpcRow[] = [];
  let listFailed = false;
  try {
    rows = await db.query<UnreadRpcRow>(
      "select * from public.unread_conversations() order by last_message_at desc limit $1 offset $2",
      [to - from + 1, from],
    );
  } catch {
    listFailed = true;
  }

  if (listFailed) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Unread Messages</h1>
        <p className="mt-2 text-destructive">Unable to load unread messages.</p>
      </div>
    );
  }

  const unreadRows = rows;
  const contactIds = unreadRows.map((row) => row.contact_id);

  type ContactRow = { id: string; name: string; phone: string; tags: string[] | null };
  let contactRows: ContactRow[] = [];
  let contactsFailed = false;
  if (contactIds.length) {
    try {
      contactRows = await db.query<ContactRow>(
        "select id, name, phone, tags from contacts where id = any($1::uuid[])",
        [contactIds],
      );
    } catch {
      contactsFailed = true;
    }
  }

  if (contactsFailed) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Unread Messages</h1>
        <p className="mt-2 text-destructive">Unable to load contact details.</p>
      </div>
    );
  }

  const contactsById = new Map(
    contactRows.map((contact) => [contact.id, contact])
  );

  const conversations: UnreadConversation[] = unreadRows.flatMap((row) => {
    const contact = contactsById.get(row.contact_id);
    if (!contact) return [];
    return [
      {
        contactId: row.contact_id,
        name: contact.name,
        phone: contact.phone,
        tags: contact.tags ?? [],
        unreadCount: Number(row.unread_count),
        lastMessageAt: row.last_message_at,
        lastMessageText: row.last_message_text,
        hasMedia: Boolean(row.last_media_url),
      },
    ];
  });

  const unknownConversations = page === 1 ? await getUnknownConversations() : [];

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Unread Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Contacts who have messaged you on WhatsApp and are still waiting for a reply.
        </p>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <UnknownNumbersList conversations={unknownConversations} />
        <UnreadMessagesList
          key={page}
          conversations={conversations}
          totalCount={totalCount}
        />
        <PaginationControls
          page={page}
          totalCount={totalCount}
          itemLabel="unread conversations"
        />
      </div>
    </div>
  );
}

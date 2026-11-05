import type { Metadata } from "next";
import { requireAuthFast } from "@/lib/auth";
import { InvestorsExplorer } from "@/components/investors-explorer";
import type { ContactRow } from "@/components/contact-details-dialog";
import type { InvestorTrackingRow } from "@/components/investor-tracking-table";
import { INVESTOR_TAGS } from "@/lib/tags";
import { PAGE_SIZE, getTotalPages, parsePage } from "@/lib/pagination";
import { db, isMissingSchemaError } from "@/lib/db";
import { ilikeAny, pageClause } from "@/lib/sql";
import { getUnreadCountsByContact } from "@/lib/unread";

export const metadata: Metadata = {
  title: "Investors",
};

type InteractionRow = {
  contact_id: string;
  created_at: string;
};

type FollowUpRow = {
  contact_id: string;
  due_date: string;
};

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search?.trim() ?? "";
  const requestedPage = parsePage(resolvedSearchParams.page);

  await requireAuthFast();

  let contacts: ContactRow[] = [];
  let interactions: InteractionRow[] = [];
  let followUps: FollowUpRow[] = [];
  let unreadCounts: Record<string, number> = {};
  let totalCount = 0;
  let page = requestedPage;
  let loadError: string | null = null;

  try {
    const filterParams: unknown[] = [INVESTOR_TAGS];
    let filter = "c.tags && $1::text[] and c.deleted_at is null";
    if (search) {
      filter += ` and ${ilikeAny(["c.name", "c.phone", "c.email", "c.company"], search, filterParams)}`;
    }

    const { count } = await db.one<{ count: number }>(
      `select count(*)::int as count from public.contacts c where ${filter}`,
      filterParams,
    );

    totalCount = count;
    // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
    page = Math.min(requestedPage, getTotalPages(totalCount));

    const loadContacts = (orderBy: string) => {
      const params = [...filterParams];
      return db.query<ContactRow>(
        `select c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes,
           coalesce((
             select json_agg(json_build_object('groups', case when g.id is null then null
                                              else json_build_object('id', g.id, 'name', g.name) end))
             from public.contact_groups cg
             left join public.groups g on g.id = cg.group_id
             where cg.contact_id = c.id
           ), '[]'::json) as contact_groups
         from public.contacts c
         where ${filter}
         order by ${orderBy}
         ${pageClause(params, page, PAGE_SIZE)}`,
        params,
      );
    };

    // Most recent chat first, like WhatsApp; then A to Z. "id" is a tie-breaker so
    // rows don't shuffle between pages. Until the chat-list migration is run the
    // last-message column doesn't exist, so fall back to A to Z.
    try {
      contacts = await loadContacts("c.last_message_at desc nulls last, c.name asc, c.id asc");
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
      contacts = await loadContacts("c.name asc, c.id asc");
    }

    const contactIds = contacts.map((contact) => contact.id);

    if (contactIds.length) {
      [interactions, followUps, unreadCounts] = await Promise.all([
        db.query<InteractionRow>(
          `select contact_id, created_at from public.interactions
           where contact_id = any($1::uuid[]) and deleted_at is null
           order by created_at desc`,
          [contactIds],
        ),
        db.query<FollowUpRow>(
          `select contact_id, due_date from public.follow_ups
           where contact_id = any($1::uuid[]) and is_done = false and deleted_at is null
           order by due_date asc`,
          [contactIds],
        ),
        getUnreadCountsByContact(),
      ]);
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Investor tracking data could not be loaded.";
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Investors</h1>
        <p className="mt-2 text-destructive">
          Error loading investors: {loadError}
        </p>
      </div>
    );
  }

  const latestInteractionByContact = new Map<string, InteractionRow>();
  for (const interaction of interactions) {
    if (!latestInteractionByContact.has(interaction.contact_id)) {
      latestInteractionByContact.set(interaction.contact_id, interaction);
    }
  }

  const nextFollowUpByContact = new Map<string, FollowUpRow>();
  for (const followUp of followUps) {
    if (!nextFollowUpByContact.has(followUp.contact_id)) {
      nextFollowUpByContact.set(followUp.contact_id, followUp);
    }
  }

  const rows: InvestorTrackingRow[] = contacts.map((contact) => ({
    ...contact,
    lastInteraction: latestInteractionByContact.get(contact.id)?.created_at ?? null,
    nextFollowUp: nextFollowUpByContact.get(contact.id)?.due_date ?? null,
  }));

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Investor Tracking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor investor interactions and upcoming follow-ups.
        </p>
      </div>

      {/* Search, table and paging (instant once all investors are loaded) */}
      <InvestorsExplorer
        // A new address from outside the list (back/forward) restarts it with that search and page.
        key={`${search}|${page}`}
        serverRows={rows}
        serverTotal={totalCount}
        unreadCounts={unreadCounts}
        initialSearch={search}
        initialPage={page}
      />
    </div>
  );
}

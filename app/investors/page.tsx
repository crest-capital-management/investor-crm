import type { Metadata } from "next";
import { requireAuthFast } from "@/lib/auth";
import { InvestorsExplorer } from "@/components/investors-explorer";
import type { ContactRow } from "@/components/contact-details-dialog";
import type { InvestorTrackingRow } from "@/components/investor-tracking-table";
import { INVESTOR_TAGS } from "@/lib/tags";
import { PAGE_SIZE, getTotalPages, parsePage } from "@/lib/pagination";
import { db } from "@/lib/db";
import { param } from "@/lib/sql";
import { contactsMatching, sortByRecentChatThenName } from "@/lib/contact-filter";
import { getUnreadCountsByContact } from "@/lib/unread";
import { CONTACT_GROUPS_COLUMN } from "@/lib/contact-queries";
import { loadSectionsInfo } from "@/lib/sections";
import { ALL_SECTIONS, parseSectionParam, sectionCondition, type SectionsInfo } from "@/lib/section-filter";

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
  searchParams: Promise<{ search?: string; page?: string; section?: string }>;
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
  let sectionsInfo: SectionsInfo | null = null;
  let section = ALL_SECTIONS;

  try {
    sectionsInfo = await loadSectionsInfo({ investorTags: INVESTOR_TAGS });
    section = parseSectionParam(resolvedSearchParams.section, sectionsInfo);

    const filterParams: unknown[] = [INVESTOR_TAGS];
    let filter = "c.tags && $1::text[] and c.deleted_at is null";
    const inSectionSql = sectionCondition(section, filterParams);
    if (inSectionSql) filter += ` and ${inSectionSql}`;
    // Name, phone (and later email, company) are encrypted, so searching and the
    // A-Z part of the order happen here on the decrypted values, then one page is loaded by id.
    const matching = sortByRecentChatThenName(await contactsMatching(filter, filterParams, search));

    totalCount = matching.length;
    // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
    page = Math.min(requestedPage, getTotalPages(totalCount));

    // Most recent chat first, like WhatsApp; then A to Z; "id" breaks ties so rows don't shuffle between pages.
    const pageIds = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => row.id);
    const params: unknown[] = [];
    const ids = param(params, pageIds);
    contacts = await db.query<ContactRow>(
      `select c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes,${sectionsInfo ? " c.section_id," : ""}
         ${CONTACT_GROUPS_COLUMN}
       from public.contacts c
       where c.id = any(${ids}::uuid[])
       order by array_position(${ids}::uuid[], c.id)`,
      params,
    );

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
        key={`${search}|${page}|${section}`}
        sectionsInfo={sectionsInfo}
        initialSection={section}
        serverRows={rows}
        serverTotal={totalCount}
        unreadCounts={unreadCounts}
        initialSearch={search}
        initialPage={page}
      />
    </div>
  );
}

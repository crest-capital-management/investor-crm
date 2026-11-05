import type { Metadata } from "next";
import { requireAuthFast } from "@/lib/auth";
import { AddContactDialog } from "@/components/add-contact-dialog";
import type { ContactRow } from "@/components/contact-details-dialog";
import { ImportContactsDialog } from "@/components/import-contacts-dialog";
import { UpdateContactsDialog } from "@/components/update-contacts-dialog";
import { ContactsExplorer } from "@/components/contacts-explorer";
import { db } from "@/lib/db";
import { PAGE_SIZE, getTotalPages, parsePage } from "@/lib/pagination";
import { getUnreadCountsByContact } from "@/lib/unread";
import { ilikeAny, pageClause, param } from "@/lib/sql";
import { INVESTOR_TAGS } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Contacts",
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tags?: string; page?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search?.trim() ?? "";
  const tagsParam = resolvedSearchParams.tags?.trim() ?? "";
  const selectedTags = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const requestedPage = parsePage(resolvedSearchParams.page);

  await requireAuthFast();

  let contacts: ContactRow[] = [];
  let filteredCount = 0;
  let page = requestedPage;
  let totalContacts = 0;
  let investors = 0;
  let taggedContacts = 0;
  let totalGroups = 0;
  let unreadCounts: Record<string, number> = {};
  let loadError: string | null = null;

  try {
    // The search and tag filter, shared by the filtered count and the page of contacts.
    const filterParams: unknown[] = [];
    const conditions = ["c.deleted_at is null"];
    if (search) conditions.push(ilikeAny(["c.name", "c.phone", "c.email", "c.company"], search, filterParams));
    if (selectedTags.length > 0) conditions.push(`c.tags && ${param(filterParams, selectedTags)}::text[]`);
    const where = conditions.join(" and ");

    const [filtered, stats, unread] = await Promise.all([
      db.one<{ count: number }>(`select count(*)::int as count from public.contacts c where ${where}`, filterParams),
      db.one<{ total: number; investors: number; tagged: number; groups: number }>(
        `select
           (select count(*)::int from public.contacts where deleted_at is null) as total,
           (select count(*)::int from public.contacts where deleted_at is null and tags && $1::text[]) as investors,
           (select count(*)::int from public.contacts where deleted_at is null and tags <> '{}') as tagged,
           (select count(*)::int from public.groups) as groups`,
        [INVESTOR_TAGS],
      ),
      getUnreadCountsByContact(),
    ]);
    unreadCounts = unread;

    filteredCount = filtered.count;
    totalContacts = stats.total;
    investors = stats.investors;
    taggedContacts = stats.tagged;
    totalGroups = stats.groups;

    // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
    page = Math.min(requestedPage, getTotalPages(filteredCount));

    // Most recent chat first, like WhatsApp; "id" is a tie-breaker so rows
    // never shuffle between pages.
    const pageParams = [...filterParams];
    const paging = pageClause(pageParams, page, PAGE_SIZE);
    contacts = await db.query<ContactRow>(
      `select c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes,
              c.last_message_at, c.last_message_text, c.last_message_direction,
              coalesce((
                select json_agg(json_build_object('groups', json_build_object('id', g.id, 'name', g.name)))
                  from public.contact_groups cg
                  join public.groups g on g.id = cg.group_id
                 where cg.contact_id = c.id
              ), '[]'::json) as contact_groups
         from public.contacts c
        where ${where}
        order by c.last_message_at desc nulls last, c.date_saved desc, c.id asc
        ${paging}`,
      pageParams,
    );
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Contacts could not be loaded.";
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="mt-2 text-destructive">
          Error loading contacts: {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage and search your contacts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <UpdateContactsDialog />
          <ImportContactsDialog />
          <AddContactDialog />
        </div>
      </div>

      {/* Overview */}
      <div className="mt-3 grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total Contacts", value: totalContacts },
          { label: "Investors", value: investors },
          { label: "Tagged Contacts", value: taggedContacts },
          { label: "Groups", value: totalGroups },
        ].map((metric) => (
          <div
            key={metric.label}
            className="flex h-18 flex-col justify-center rounded-lg border bg-background px-4 py-3"
          >
            <p className="text-2xl font-semibold tracking-tight">
              {metric.value}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {metric.label}
            </p>
          </div>
        ))}
      </div>

      {/* Search, tag filter, table and paging (instant once all contacts are loaded) */}
      <ContactsExplorer
        // A new address from outside the list (a sidebar tag link, back/forward)
        // restarts it with that search, tags and page.
        key={`${search}|${tagsParam}|${page}`}
        serverContacts={contacts}
        serverFilteredCount={filteredCount}
        unreadCounts={unreadCounts}
        initialSearch={search}
        initialTags={selectedTags}
        initialPage={page}
      />
    </div>
  );
}

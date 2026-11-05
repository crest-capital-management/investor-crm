import type { Metadata } from "next";
import { AddGroupDialog } from "@/components/add-group-dialog";
import { GroupRow } from "@/components/group-details-dialog";
import { GroupsTable } from "@/components/groups-table";
import { LiveSearchInput } from "@/components/live-search-input";
import { PaginationControls } from "@/components/pagination-controls";
import { normalizeGroupMembers, type GroupContactRelation } from "@/lib/group-members";
import { requireAuthFast } from "@/lib/auth";
import { db } from "@/lib/db";
import { PAGE_SIZE, getTotalPages, parsePage } from "@/lib/pagination";
import { ilikeAny, pageClause } from "@/lib/sql";

export const metadata: Metadata = {
  title: "Groups",
};

type GroupQueryRow = {
  id: string;
  name: string;
  created_at: string;
  contact_groups: GroupContactRelation[];
};

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search?.trim() ?? "";
  const requestedPage = parsePage(resolvedSearchParams.page);
  await requireAuthFast();

  const errorView = <div className="p-4 sm:p-6 lg:p-8"><h1 className="text-2xl font-semibold">Groups</h1><p className="mt-2 text-destructive">Unable to load groups.</p></div>;

  const filterParams: unknown[] = [];
  const where = search ? `where ${ilikeAny(["g.name"], search, filterParams)}` : "";

  let totalCount: number;
  try {
    const row = await db.one<{ count: number }>(
      `select count(*)::int as count from public.groups g ${where}`,
      filterParams,
    );
    totalCount = row.count;
  } catch {
    return errorView;
  }

  // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
  const page = Math.min(requestedPage, getTotalPages(totalCount));

  let data: GroupQueryRow[];
  try {
    const params = [...filterParams];
    data = await db.query<GroupQueryRow>(
      `select g.id, g.name, g.created_at,
         coalesce((
           select json_agg(json_build_object(
             'contact_id', cg.contact_id,
             'contacts', case when c.id is null then null
                              else json_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'deleted_at', c.deleted_at) end
           ))
           from public.contact_groups cg
           left join public.contacts c on c.id = cg.contact_id
           where cg.group_id = g.id
         ), '[]'::json) as contact_groups
       from public.groups g
       ${where}
       order by g.created_at desc, g.id asc
       ${pageClause(params, page, PAGE_SIZE)}`,
      params,
    );
  } catch {
    return errorView;
  }

  const groups = data.map((group) => ({
    ...group,
    contact_groups: normalizeGroupMembers(group.contact_groups),
  })) as GroupRow[];
  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-semibold">Groups</h1><p className="mt-1 text-sm text-muted-foreground">Organize contacts into groups.</p></div><AddGroupDialog /></div>
      <LiveSearchInput paramName="search" placeholder="Search by group name..." />
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <GroupsTable key={`${search}-${page}`} groups={groups} search={search} />
        <PaginationControls page={page} totalCount={totalCount} itemLabel="groups" />
      </div>
    </div>
  );
}

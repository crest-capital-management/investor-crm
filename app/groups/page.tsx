import type { Metadata } from "next";
import { AddGroupDialog } from "@/components/add-group-dialog";
import { GroupRow } from "@/components/group-details-dialog";
import { GroupsTable } from "@/components/groups-table";
import { LiveSearchInput } from "@/components/live-search-input";
import { normalizeGroupMembers, type GroupContactRelation } from "@/lib/group-members";
import { requireAuth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Groups",
};

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const search = (await searchParams).search?.trim() ?? "";
  const { supabase } = await requireAuth();
  let groupsQuery = supabase.from("groups").select("id, name, created_at, contact_groups(contact_id, contacts(id, name, phone, deleted_at))");
  if (search) groupsQuery = groupsQuery.ilike("name", `%${search}%`);
  const { data, error } = await groupsQuery.order("created_at", { ascending: false });

  if (error) {
    return <div className="p-4 sm:p-6 lg:p-8"><h1 className="text-2xl font-semibold">Groups</h1><p className="mt-2 text-destructive">Unable to load groups.</p></div>;
  }

  const groups = (data ?? []).map((group) => ({
    ...group,
    contact_groups: normalizeGroupMembers(
      group.contact_groups as GroupContactRelation[],
    ),
  })) as GroupRow[];
  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-semibold">Groups</h1><p className="mt-1 text-sm text-muted-foreground">Organize contacts into groups.</p></div><AddGroupDialog /></div>
      <LiveSearchInput paramName="search" placeholder="Search by group name..." />
      <div className="mt-3 flex min-h-0 flex-1 flex-col"><GroupsTable key={search} groups={groups} search={search} /></div>
    </div>
  );
}

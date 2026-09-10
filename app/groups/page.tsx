import { AddGroupDialog } from "@/components/add-group-dialog";
import { GroupRow } from "@/components/group-details-dialog";
import { GroupsTable } from "@/components/groups-table";
import { Input } from "@/components/ui/input";
import { normalizeGroupMembers, type GroupContactRelation } from "@/lib/group-members";
import { createClient } from "@/src/lib/supabase/server";

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const search = (await searchParams).search?.trim() ?? "";
  const supabase = await createClient();
  let groupsQuery = supabase.from("groups").select("id, name, created_at, contact_groups(contact_id, contacts(id, name, phone))");
  if (search) groupsQuery = groupsQuery.ilike("name", `%${search}%`);
  const { data, error } = await groupsQuery.order("created_at", { ascending: false });

  if (error) {
    return <div className="p-8"><h1 className="text-2xl font-semibold">Groups</h1><p className="mt-2 text-destructive">Unable to load groups.</p></div>;
  }

  const groups = (data ?? []).map((group) => ({
    ...group,
    contact_groups: normalizeGroupMembers(
      group.contact_groups as GroupContactRelation[],
    ),
  })) as GroupRow[];
  return (
    <div className="flex min-h-0 flex-col p-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Groups</h1><p className="mt-1 text-sm text-muted-foreground">Organize contacts into groups.</p></div><AddGroupDialog /></div>
      <form action="/groups" method="get" className="mt-3 max-w-md"><Input name="search" defaultValue={search} placeholder="Search by group name..." className="h-10" /></form>
      <div className="mt-3 flex min-h-0 flex-1 flex-col"><GroupsTable key={search} groups={groups} search={search} /></div>
    </div>
  );
}

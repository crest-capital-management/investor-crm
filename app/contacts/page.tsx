import { createClient } from "@/src/lib/supabase/server";
import { AddContactDialog } from "@/components/add-contact-dialog";
import type { ContactRow } from "@/components/contact-details-dialog";
import { ContactsTable } from "@/components/contacts-table";
import { ImportContactsDialog } from "@/components/import-contacts-dialog";
import { Input } from "@/components/ui/input";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const search = (await searchParams).search?.trim() ?? "";

  const supabase = await createClient();

  let contactsQuery = supabase
    .from("contacts")
    .select(
      "id, name, phone, tags, date_saved, contact_groups(groups(id, name))"
    );

  if (search) {
    contactsQuery = contactsQuery.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const [contactsResult, contactMetricsResult, groupsResult] = await Promise.all([
    contactsQuery.order("date_saved", { ascending: false }),
    supabase.from("contacts").select("tags"),
    supabase.from("groups").select("id"),
  ]);

  const { data: contacts, error } = contactsResult;
  const { data: contactMetrics, error: contactMetricsError } =
    contactMetricsResult;
  const { data: groups, error: groupsError } = groupsResult;

  if (error || contactMetricsError || groupsError) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="mt-2 text-destructive">
          Error loading contacts: {(error || contactMetricsError || groupsError)?.message}
        </p>
      </div>
    );
  }

  const totalContacts = contactMetrics?.length ?? 0;
  const investors =
    contactMetrics?.filter((contact) =>
      contact.tags?.some((tag: string) => tag.toLowerCase() === "investor")
    ).length ?? 0;
  const taggedContacts =
    contactMetrics?.filter((contact) => contact.tags?.length).length ?? 0;
  const totalGroups = groups?.length ?? 0;

  return (
    <div className="flex min-h-0 flex-col p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage and search your contacts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ImportContactsDialog />
          <AddContactDialog />
        </div>
      </div>

      {/* Overview */}
      <div className="mt-3 grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* Search */}
      <form action="/contacts" method="get" className="mt-3 max-w-md">
        <Input
          name="search"
          defaultValue={search}
          placeholder="Search by name or phone..."
          className="h-10"
        />
      </form>

      {/* Table */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <ContactsTable
          key={search}
          contacts={(contacts ?? []) as ContactRow[]}
          search={search}
        />
      </div>
    </div>
  );
}
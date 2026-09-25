import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth";
import { AddContactDialog } from "@/components/add-contact-dialog";
import type { ContactRow } from "@/components/contact-details-dialog";
import { ContactsTable } from "@/components/contacts-table";
import { ImportContactsDialog } from "@/components/import-contacts-dialog";
import { LiveSearchInput } from "@/components/live-search-input";
import { TagFilter } from "@/components/tag-filter";
import { isInvestorTag } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Contacts",
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tags?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search?.trim() ?? "";
  const tagsParam = resolvedSearchParams.tags?.trim() ?? "";
  const selectedTags = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const { supabase } = await requireAuth();

  let contactsQuery = supabase
    .from("contacts")
    .select(
      "id, name, phone, email, tags, date_saved, contact_groups(groups(id, name))"
    )
    .is("deleted_at", null);

  if (search) {
    contactsQuery = contactsQuery.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    );
  }

  if (selectedTags.length > 0) {
    contactsQuery = contactsQuery.overlaps("tags", selectedTags);
  }

  const [contactsResult, contactMetricsResult, groupsResult] = await Promise.all([
    contactsQuery.order("date_saved", { ascending: false }),
    supabase.from("contacts").select("tags").is("deleted_at", null),
    supabase.from("groups").select("id"),
  ]);

  const { data: contacts, error } = contactsResult;
  const { data: contactMetrics, error: contactMetricsError } =
    contactMetricsResult;
  const { data: groups, error: groupsError } = groupsResult;

  if (error || contactMetricsError || groupsError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
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
      contact.tags?.some((tag: string) => isInvestorTag(tag))
    ).length ?? 0;
  const taggedContacts =
    contactMetrics?.filter((contact) => contact.tags?.length).length ?? 0;
  const totalGroups = groups?.length ?? 0;

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

      {/* Search & Tag Filter */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5 sm:gap-3">
        <LiveSearchInput
          paramName="search"
          placeholder="Search by name, phone, or email..."
          className="mt-0 w-full sm:w-80 max-w-md"
        />
        <TagFilter />
      </div>

      {/* Table */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <ContactsTable
          key={`${search}-${tagsParam}`}
          contacts={(contacts ?? []) as ContactRow[]}
          search={search}
        />
      </div>
    </div>
  );
}
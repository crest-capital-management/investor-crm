import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth";
import { LiveSearchInput } from "@/components/live-search-input";
import {
  InvestorTrackingTable,
  type InvestorTrackingRow,
} from "@/components/investor-tracking-table";

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
  searchParams: Promise<{ search?: string }>;
}) {
  const search = (await searchParams).search?.trim() ?? "";

  const { supabase } = await requireAuth();

  let contactsQuery = supabase
    .from("contacts")
    .select("id, name, phone, email, tags, date_saved, contact_groups(groups(id, name))")
    .contains("tags", ["Investor"])
    .is("deleted_at", null);

  if (search) {
    contactsQuery = contactsQuery.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    );
  }

  const { data: contacts, error: contactsError } = await contactsQuery.order("name", {
    ascending: true,
  });

  if (contactsError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Investors</h1>
        <p className="mt-2 text-destructive">
          Error loading investors: {contactsError.message}
        </p>
      </div>
    );
  }

  const contactIds = (contacts ?? []).map((contact) => contact.id);
  const [{ data: interactions, error: interactionsError }, { data: followUps, error: followUpsError }] =
    contactIds.length
      ? await Promise.all([
          supabase
            .from("interactions")
            .select("contact_id, created_at")
            .in("contact_id", contactIds)
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
          supabase
            .from("follow_ups")
            .select("contact_id, due_date")
            .in("contact_id", contactIds)
            .eq("is_done", false)
            .is("deleted_at", null)
            .order("due_date", { ascending: true }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (interactionsError || followUpsError) {
    const error = interactionsError || followUpsError;
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Investors</h1>
        <p className="mt-2 text-destructive">
          Error loading investor tracking: {error?.message}
        </p>
      </div>
    );
  }

  const latestInteractionByContact = new Map<string, InteractionRow>();
  for (const interaction of (interactions ?? []) as InteractionRow[]) {
    if (!latestInteractionByContact.has(interaction.contact_id)) {
      latestInteractionByContact.set(interaction.contact_id, interaction);
    }
  }

  const nextFollowUpByContact = new Map<string, FollowUpRow>();
  for (const followUp of (followUps ?? []) as FollowUpRow[]) {
    if (!nextFollowUpByContact.has(followUp.contact_id)) {
      nextFollowUpByContact.set(followUp.contact_id, followUp);
    }
  }

  const rows = (contacts ?? []).map((contact) => ({
    ...contact,
    lastInteraction: latestInteractionByContact.get(contact.id)?.created_at ?? null,
    nextFollowUp: nextFollowUpByContact.get(contact.id)?.due_date ?? null,
  })) as InvestorTrackingRow[];

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Investor Tracking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor investor interactions and upcoming follow-ups.
        </p>
      </div>

      <LiveSearchInput
        paramName="search"
        placeholder="Search by name, phone, or email..."
      />

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <InvestorTrackingTable investors={rows} />
      </div>
    </div>
  );
}

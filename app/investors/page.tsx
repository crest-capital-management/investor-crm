import { requireAuth } from "@/lib/auth";
import {
  InvestorTrackingTable,
  type InvestorTrackingRow,
} from "@/components/investor-tracking-table";

type InteractionRow = {
  contact_id: string;
  created_at: string;
};

type FollowUpRow = {
  contact_id: string;
  due_date: string;
};

export default async function InvestorsPage() {
  const { supabase } = await requireAuth();
  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id, name, phone, tags, date_saved, contact_groups(groups(id, name))")
    .contains("tags", ["Investor"])
    .order("name", { ascending: true });

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
            .order("created_at", { ascending: false }),
          supabase
            .from("follow_ups")
            .select("contact_id, due_date")
            .in("contact_id", contactIds)
            .eq("is_done", false)
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

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <InvestorTrackingTable investors={rows} />
      </div>
    </div>
  );
}

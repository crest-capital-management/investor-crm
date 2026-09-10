import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { InvestorDetail } from "@/components/investor-detail";
import type { MeetingNote } from "@/app/contacts/actions";
import type { FollowUp } from "@/app/investors/actions";

export default async function InvestorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireAuth();
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, name, phone, email, tags")
    .eq("id", id)
    .maybeSingle();

  if (contactError || !contact || !contact.tags?.some((tag: string) => tag.toLowerCase() === "investor")) {
    notFound();
  }

  const { data: notes, error: notesError } = await supabase
    .from("interactions")
    .select("id, note, created_at")
    .eq("contact_id", id)
    .eq("type", "meeting")
    .order("created_at", { ascending: false });

  const { data: followUps, error: followUpsError } = await supabase
    .from("follow_ups")
    .select("id, due_date, message, is_done, created_at")
    .eq("contact_id", id)
    .order("is_done", { ascending: true })
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true });

  return (
    <InvestorDetail
      contact={contact}
      initialNotes={notesError ? [] : (notes ?? []) as MeetingNote[]}
      notesError={notesError ? "Meeting notes could not be loaded." : null}
      initialFollowUps={followUpsError ? [] : (followUps ?? []) as FollowUp[]}
      followUpsError={followUpsError ? "Follow-ups could not be loaded." : null}
    />
  );
}

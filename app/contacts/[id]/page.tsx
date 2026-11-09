import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PORTFOLIO_UPDATE_COLUMNS, type PortfolioUpdate } from "@/lib/portfolio-types";
import { PROSPECT_SCORE_COLUMNS, type ProspectScore } from "@/lib/prospect-score-types";
import type { QueryResultRow } from "pg";
import { db, isMissingSchemaError } from "@/lib/db";
import type { ContactRow } from "@/components/contact-details-dialog";
import { requireAuthFast } from "@/lib/auth";
import { getUnreadCountsByContact } from "@/lib/unread";
import { loadContactSection } from "@/lib/sections";
import { ContactDetail } from "@/components/contact-detail";
import type { MeetingNote } from "@/app/contacts/actions";
import type { FollowUp } from "@/app/investors/actions";
import type { WhatsAppMessage } from "@/components/whatsapp-history";

export const metadata: Metadata = {
  title: "Contact Details",
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuthFast();

  let contact: (ContactRow & { whatsapp_summary: string | null; whatsapp_summary_generated_at: string | null }) | null;
  try {
    contact = await db.maybeOne(
      `select c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes,
              c.whatsapp_summary, c.whatsapp_summary_generated_at,
              coalesce((
                select json_agg(json_build_object('groups', json_build_object('id', g.id, 'name', g.name)))
                  from public.contact_groups cg
                  join public.groups g on g.id = cg.group_id
                 where cg.contact_id = c.id
              ), '[]'::json) as contact_groups
         from public.contacts c
        where c.id = $1 and c.deleted_at is null`,
      [id],
    );
  } catch {
    contact = null;
  }

  if (!contact) {
    notFound();
  }

  // Each section loads on its own, so one failing query only hides that section.
  async function load<T extends QueryResultRow>(sql: string): Promise<{ data: T[]; error: unknown }> {
    try {
      return { data: await db.query<T>(sql, [id]), error: null };
    } catch (error) {
      return { data: [], error };
    }
  }

  const { data: notes, error: notesError } = await load<MeetingNote>(
    `select id, note, created_at from public.interactions
      where contact_id = $1 and type = 'meeting' and deleted_at is null
      order by created_at desc`,
  );

  const { data: followUps, error: followUpsError } = await load<FollowUp>(
    `select id, due_date, message, is_done, created_at from public.follow_ups
      where contact_id = $1 and deleted_at is null
      order by is_done asc, due_date asc, created_at asc`,
  );

  const { data: whatsappMessages, error: whatsAppMessagesError } = await load<WhatsAppMessage>(
    `select * from public.whatsapp_messages
      where contact_id = $1 and deleted_at is null
      order by sent_at asc`,
  );

  const { data: portfolioUpdates, error: portfolioUpdatesError } = await load<PortfolioUpdate>(
    `select ${PORTFOLIO_UPDATE_COLUMNS} from public.portfolio_updates
      where contact_id = $1 and deleted_at is null
      order by created_at desc`,
  );

  // Read separately so the page still opens before the prospect score migration has been run.
  let prospectScore: ProspectScore | null = null;
  let prospectScoreError: unknown = null;
  try {
    prospectScore = await db.maybeOne<ProspectScore>(
      `select ${PROSPECT_SCORE_COLUMNS} from public.contacts where id = $1`,
      [id],
    );
  } catch (error) {
    prospectScoreError = error;
  }

  const [unreadCounts, section] = await Promise.all([getUnreadCountsByContact(), loadContactSection(id)]);

  return (
    <ContactDetail
      contact={contact}
      section={section}
      initialNotes={notesError ? [] : notes}
      notesError={notesError ? "Meeting notes could not be loaded." : null}
      initialFollowUps={followUpsError ? [] : followUps}
      followUpsError={followUpsError ? "Follow-ups could not be loaded." : null}
      initialWhatsAppMessages={whatsAppMessagesError ? [] : whatsappMessages}
      whatsAppMessagesError={whatsAppMessagesError ? "WhatsApp messages could not be loaded." : null}
      initialWhatsAppSummary={contact.whatsapp_summary ?? null}
      initialWhatsAppSummaryGeneratedAt={contact.whatsapp_summary_generated_at ?? null}
      initialPortfolioUpdates={portfolioUpdatesError ? [] : portfolioUpdates}
      portfolioUpdatesError={
        portfolioUpdatesError
          ? isMissingSchemaError(portfolioUpdatesError)
            ? "Portfolio updates aren't set up yet. Run the latest database migration (portfolio_updates) first."
            : "Portfolio updates could not be loaded."
          : null
      }
      initialProspectScore={prospectScoreError || !prospectScore ? undefined : prospectScore}
      prospectScoreError={
        prospectScoreError
          ? isMissingSchemaError(prospectScoreError)
            ? "Prospect score isn't set up yet. Run the latest database migration (prospect score) first."
            : "The prospect score could not be loaded."
          : null
      }
      initialUnreadCount={unreadCounts[contact.id] ?? 0}
    />
  );
}

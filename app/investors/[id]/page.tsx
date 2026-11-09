import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PORTFOLIO_UPDATE_COLUMNS, type PortfolioUpdate } from "@/lib/portfolio-types";
import { PROSPECT_SCORE_COLUMNS, type ProspectScore } from "@/lib/prospect-score-types";
import { requireAuthFast } from "@/lib/auth";
import { db, isMissingSchemaError } from "@/lib/db";
import { getUnreadCountsByContact } from "@/lib/unread";
import { loadContactSection } from "@/lib/sections";
import { InvestorDetail, type WhatsAppMessage } from "@/components/investor-detail";
import type { MeetingNote } from "@/app/contacts/actions";
import type { FollowUp } from "@/app/investors/actions";
import { isInvestorTag } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Investor Details",
};

export default async function InvestorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuthFast();

  type DetailContact = {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    tags: string[] | null;
    date_saved: string | null;
    notes: string | null;
    whatsapp_summary: string | null;
    whatsapp_summary_generated_at: string | null;
    contact_groups: Array<{ groups: { id: string; name: string } }>;
  };

  let contact: DetailContact | null;
  try {
    contact = await db.maybeOne<DetailContact>(
      `select c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes,
         c.whatsapp_summary, c.whatsapp_summary_generated_at,
         coalesce((
           select json_agg(json_build_object('groups', case when g.id is null then null
                                            else json_build_object('id', g.id, 'name', g.name) end))
           from public.contact_groups cg
           left join public.groups g on g.id = cg.group_id
           where cg.contact_id = c.id
         ), '[]'::json) as contact_groups
       from public.contacts c
       where c.id = $1 and c.deleted_at is null`,
      [id],
    );
  } catch {
    contact = null;
  }

  if (!contact || !contact.tags?.some((tag: string) => isInvestorTag(tag))) {
    notFound();
  }

  // Each section loads on its own, so one failing section doesn't hide the rest of the page.
  async function load<T>(run: () => Promise<T>): Promise<{ data: T | null; error: unknown }> {
    try {
      return { data: await run(), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // The sections don't depend on each other, so they load in parallel.
  const [
    { data: notes, error: notesError },
    { data: followUps, error: followUpsError },
    { data: whatsappMessages, error: whatsAppMessagesError },
    { data: portfolioUpdates, error: portfolioUpdatesError },
    { data: prospectScore, error: prospectScoreError },
    unreadCounts,
    section,
  ] = await Promise.all([
    load(() =>
      db.query<MeetingNote>(
        `select id, note, created_at from public.interactions
         where contact_id = $1 and type = 'meeting' and deleted_at is null
         order by created_at desc`,
        [id],
      ),
    ),
    load(() =>
      db.query<FollowUp>(
        `select id, due_date, message, is_done, created_at from public.follow_ups
         where contact_id = $1 and deleted_at is null
         order by is_done asc, due_date asc, created_at asc`,
        [id],
      ),
    ),
    load(() =>
      db.query<WhatsAppMessage>(
        `select * from public.whatsapp_messages
         where contact_id = $1 and deleted_at is null
         order by sent_at asc`,
        [id],
      ),
    ),
    load(() =>
      db.query<PortfolioUpdate>(
        `select ${PORTFOLIO_UPDATE_COLUMNS} from public.portfolio_updates
         where contact_id = $1 and deleted_at is null
         order by created_at desc`,
        [id],
      ),
    ),
    // Read separately so the page still opens before the prospect score migration has been run.
    load(() =>
      db.maybeOne<ProspectScore>(
        `select ${PROSPECT_SCORE_COLUMNS} from public.contacts where id = $1`,
        [id],
      ),
    ),
    getUnreadCountsByContact(),
    loadContactSection(id),
  ]);

  return (
    <InvestorDetail
      contact={contact}
      section={section}
      initialNotes={notesError ? [] : (notes ?? [])}
      notesError={notesError ? "Meeting notes could not be loaded." : null}
      initialFollowUps={followUpsError ? [] : (followUps ?? [])}
      followUpsError={followUpsError ? "Follow-ups could not be loaded." : null}
      initialWhatsAppMessages={whatsAppMessagesError ? [] : (whatsappMessages ?? [])}
      whatsAppMessagesError={whatsAppMessagesError ? "WhatsApp messages could not be loaded." : null}
      initialWhatsAppSummary={contact.whatsapp_summary ?? null}
      initialWhatsAppSummaryGeneratedAt={contact.whatsapp_summary_generated_at ?? null}
      initialPortfolioUpdates={portfolioUpdatesError ? [] : (portfolioUpdates ?? [])}
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

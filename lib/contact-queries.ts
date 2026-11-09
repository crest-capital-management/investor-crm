import type { QueryResultRow } from "pg";

import { db } from "@/lib/db";
import { PORTFOLIO_UPDATE_COLUMNS, type PortfolioUpdate } from "@/lib/portfolio-types";
import { PROSPECT_SCORE_COLUMNS, type ProspectScore } from "@/lib/prospect-score-types";
import { loadContactSection, type ContactSectionInfo } from "@/lib/sections";
import { getUnreadCountsByContact } from "@/lib/unread";
import type { ContactRow } from "@/components/contact-details-dialog";
import type { WhatsAppMessage } from "@/components/whatsapp-history";
import type { MeetingNote } from "@/app/contacts/actions";
import type { FollowUp } from "@/app/investors/actions";

/**
 * A contact's groups as a JSON column named contact_groups, in the shape the
 * app has always used: [{ groups: { id, name } }]. Needs the contact aliased `c`.
 * (contact_groups.group_id cascades on delete, so every row has its group.)
 */
export const CONTACT_GROUPS_COLUMN = `coalesce(
  (select json_agg(json_build_object('groups', json_build_object('id', g.id, 'name', g.name)))
     from public.contact_groups cg
     join public.groups g on g.id = cg.group_id
    where cg.contact_id = c.id),
  '[]'::json
) as contact_groups`;

export type DetailContact = ContactRow & {
  whatsapp_summary: string | null;
  whatsapp_summary_generated_at: string | null;
};

/** Everything the contact / investor detail screen needs, as its props. */
export type ContactDetailData = {
  contact: DetailContact;
  section: ContactSectionInfo | null;
  initialNotes: MeetingNote[];
  notesError: string | null;
  initialFollowUps: FollowUp[];
  followUpsError: string | null;
  initialWhatsAppMessages: WhatsAppMessage[];
  whatsAppMessagesError: string | null;
  initialWhatsAppSummary: string | null;
  initialWhatsAppSummaryGeneratedAt: string | null;
  initialPortfolioUpdates: PortfolioUpdate[];
  portfolioUpdatesError: string | null;
  initialProspectScore: ProspectScore | undefined;
  prospectScoreError: string | null;
  initialUnreadCount: number;
};

/**
 * Loads a contact and every section of its detail screen. Returns null when the
 * contact doesn't exist, is deleted, or the id is malformed. Each section loads
 * on its own (in parallel), so one failing query only hides that section.
 */
export async function loadContactDetail(id: string): Promise<ContactDetailData | null> {
  let contact: DetailContact | null;
  try {
    contact = await db.maybeOne<DetailContact>(
      `select c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes,
              c.whatsapp_summary, c.whatsapp_summary_generated_at,
              ${CONTACT_GROUPS_COLUMN}
         from public.contacts c
        where c.id = $1 and c.deleted_at is null`,
      [id],
    );
  } catch {
    contact = null;
  }
  if (!contact) return null;

  async function load<T extends QueryResultRow>(sql: string): Promise<{ data: T[]; error: unknown }> {
    try {
      return { data: await db.query<T>(sql, [id]), error: null };
    } catch (error) {
      return { data: [], error };
    }
  }

  const [notes, followUps, messages, portfolioUpdates, prospectScore, unreadCounts, section] = await Promise.all([
    load<MeetingNote>(
      `select id, note, created_at from public.interactions
        where contact_id = $1 and type = 'meeting' and deleted_at is null
        order by created_at desc`,
    ),
    load<FollowUp>(
      `select id, due_date, message, is_done, created_at from public.follow_ups
        where contact_id = $1 and deleted_at is null
        order by is_done asc, due_date asc, created_at asc`,
    ),
    load<WhatsAppMessage>(
      `select * from public.whatsapp_messages
        where contact_id = $1 and deleted_at is null
        order by sent_at asc`,
    ),
    load<PortfolioUpdate>(
      `select ${PORTFOLIO_UPDATE_COLUMNS} from public.portfolio_updates
        where contact_id = $1 and deleted_at is null
        order by created_at desc`,
    ),
    load<ProspectScore>(`select ${PROSPECT_SCORE_COLUMNS} from public.contacts where id = $1`),
    getUnreadCountsByContact(),
    loadContactSection(id),
  ]);

  const score = prospectScore.data[0];

  return {
    contact,
    section,
    initialNotes: notes.error ? [] : notes.data,
    notesError: notes.error ? "Meeting notes could not be loaded." : null,
    initialFollowUps: followUps.error ? [] : followUps.data,
    followUpsError: followUps.error ? "Follow-ups could not be loaded." : null,
    initialWhatsAppMessages: messages.error ? [] : messages.data,
    whatsAppMessagesError: messages.error ? "WhatsApp messages could not be loaded." : null,
    initialWhatsAppSummary: contact.whatsapp_summary ?? null,
    initialWhatsAppSummaryGeneratedAt: contact.whatsapp_summary_generated_at ?? null,
    initialPortfolioUpdates: portfolioUpdates.error ? [] : portfolioUpdates.data,
    portfolioUpdatesError: portfolioUpdates.error ? "Portfolio updates could not be loaded." : null,
    initialProspectScore: prospectScore.error || !score ? undefined : score,
    prospectScoreError: prospectScore.error ? "The prospect score could not be loaded." : null,
    initialUnreadCount: unreadCounts[contact.id] ?? 0,
  };
}

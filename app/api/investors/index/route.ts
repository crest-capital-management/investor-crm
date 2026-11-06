import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOwnerSessionId } from "@/lib/auth";
import { INVESTOR_TAGS } from "@/lib/tags";

export const dynamic = "force-dynamic";

const BASE_COLUMNS = "id, name, phone, email, company, tags, date_saved, notes";
const WITH_LAST_MESSAGE = `${BASE_COLUMNS}, last_message_at, last_message_text, last_message_direction`;

type Row = Record<string, unknown>;

/**
 * Every investor with their last interaction and next follow-up, in one
 * response, so the Investors page can search and page instantly in the browser.
 * Only the CRM owner can call it.
 */
export async function GET() {
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  async function loadInvestors(columns: string) {
    return db.query<Row>(
      `select ${columns} from contacts where tags && $1::text[] and deleted_at is null order by id asc`,
      [INVESTOR_TAGS],
    );
  }

  try {
    let investors: Row[];
    try {
      investors = await loadInvestors(`${WITH_LAST_MESSAGE}, section_id`);
    } catch {
      try {
        // section_id doesn't exist until azure/003_contact_sections.sql is applied.
        investors = await loadInvestors(WITH_LAST_MESSAGE);
      } catch {
        // The last-message columns don't exist until the chat-list migration is run.
        investors = await loadInvestors(BASE_COLUMNS);
      }
    }

    // The latest interaction and the earliest pending follow-up per contact.
    const [interactions, followUps] = await Promise.all([
      db.query<{ contact_id: string; created_at: string }>(
        `select contact_id, max(created_at) as created_at
           from interactions where deleted_at is null and contact_id is not null
          group by contact_id`,
      ),
      db.query<{ contact_id: string; due_date: string }>(
        `select contact_id, min(due_date) as due_date
           from follow_ups where is_done = false and deleted_at is null and contact_id is not null
          group by contact_id`,
      ),
    ]);

    const lastInteraction = new Map<string, string>();
    for (const interaction of interactions) {
      lastInteraction.set(interaction.contact_id, interaction.created_at);
    }
    const nextFollowUp = new Map<string, string>();
    for (const followUp of followUps) {
      nextFollowUp.set(followUp.contact_id, followUp.due_date);
    }

    const rows = investors.map((investor) => ({
      ...investor,
      contact_groups: null,
      lastInteraction: lastInteraction.get(String(investor.id)) ?? null,
      nextFollowUp: nextFollowUp.get(String(investor.id)) ?? null,
    }));
    return NextResponse.json({ investors: rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Investors could not be loaded." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOwnerSessionId } from "@/lib/auth";
import { CONTACT_GROUPS_COLUMN } from "@/lib/contact-queries";

export const dynamic = "force-dynamic";

const BASE_COLUMNS = "c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes";
const WITH_LAST_MESSAGE = `${BASE_COLUMNS}, c.last_message_at, c.last_message_text, c.last_message_direction`;

/**
 * Every active contact in one compact response. The Contacts page keeps this
 * in memory so searching, filtering and paging happen instantly in the browser
 * instead of asking the server on every keystroke. Only the CRM owner
 * can call it.
 */
export async function GET() {
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  async function load(columns: string) {
    return db.query<Record<string, unknown>>(
      `select ${columns}, ${CONTACT_GROUPS_COLUMN} from contacts c where c.deleted_at is null order by c.id asc`,
    );
  }

  try {
    let contacts: Record<string, unknown>[];
    try {
      contacts = await load(`${WITH_LAST_MESSAGE}, c.section_id`);
    } catch {
      try {
        // section_id doesn't exist until azure/003_contact_sections.sql is applied.
        contacts = await load(WITH_LAST_MESSAGE);
      } catch {
        // The last-message columns don't exist until the chat-list migration is run.
        contacts = await load(BASE_COLUMNS);
      }
    }
    return NextResponse.json({ contacts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Contacts could not be loaded." }, { status: 500 });
  }
}

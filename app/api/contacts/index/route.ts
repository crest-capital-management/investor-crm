import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOwnerSessionId } from "@/lib/auth";
import { CONTACT_GROUPS_COLUMN } from "@/lib/contact-queries";

export const dynamic = "force-dynamic";

const COLUMNS =
  "c.id, c.name, c.phone, c.email, c.company, c.tags, c.date_saved, c.notes, " +
  "c.last_message_at, c.last_message_text, c.last_message_direction, c.section_id";

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

  try {
    const contacts = await db.query<Record<string, unknown>>(
      `select ${COLUMNS}, ${CONTACT_GROUPS_COLUMN} from contacts c where c.deleted_at is null order by c.id asc`,
    );
    return NextResponse.json({ contacts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Contacts could not be loaded." }, { status: 500 });
  }
}

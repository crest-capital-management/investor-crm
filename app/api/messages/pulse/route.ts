import { NextResponse } from "next/server";
import { getOwnerSessionId } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A tiny fingerprint of the WhatsApp message table (how many messages, the newest
 * one, and how many have been delivered or read). The browser polls this every few
 * seconds and only reloads the chat lists when the fingerprint changes.
 */
export async function GET() {
  // Checked from the signed session cookie (no database call), since this runs every few seconds per open tab.
  if (!(await getOwnerSessionId())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const row = await db.one<{ fingerprint: string }>(
      `select concat_ws(
                '|',
                count(*),
                coalesce(max(created_at)::text, ''),
                count(*) filter (where status in ('delivered', 'read')),
                count(*) filter (where status = 'read'),
                count(*) filter (where status = 'failed')
              ) as fingerprint
         from public.whatsapp_messages
        where deleted_at is null`,
    );
    return NextResponse.json({ fingerprint: row.fingerprint }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not check for new messages." }, { status: 500 });
  }
}

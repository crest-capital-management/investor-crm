import { NextResponse } from "next/server";
import { buildCrmBackup } from "@/lib/backup";
import { getOwnerSessionId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let backup;
  try {
    backup = await buildCrmBackup();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Backup failed: ${message}` }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="crest-crm-backup-${today}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

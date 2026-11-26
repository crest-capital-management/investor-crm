import { NextResponse } from "next/server";
import { buildCrmBackup, encodeBackupFile } from "@/lib/backup";
import { getOwnerSessionId } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Downloads a fresh full backup. Like the stored backups it is encrypted with
 * the backup key (lib/backup-encryption.ts), so it stays protected on the PC
 * it is saved to. It can be restored from My Profile as it is; to read it
 * outside the CRM: node azure/decrypt-backup.mjs <file>.
 */
export async function GET() {
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let file: Buffer;
  try {
    file = encodeBackupFile(await buildCrmBackup());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Backup failed: ${message}` }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="crest-crm-backup-${today}.json.gz.enc"`,
      "Cache-Control": "no-store",
    },
  });
}

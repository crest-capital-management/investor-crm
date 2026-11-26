import { NextResponse } from "next/server";
import { getOwnerSessionId } from "@/lib/auth";
import { encryptBackup, isEncryptedBackup } from "@/lib/backup-encryption";
import { saveBackupFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The web server in front of the app accepts up to 20 MB; the browser compresses the file first.
const MAX_BYTES = 19 * 1024 * 1024;

/**
 * Receives a backup file the owner wants to restore from and stores it,
 * encrypted, in the private backups container. The browser sends an encrypted
 * backup (.json.gz.enc) as it is, and gzips an older plain one; a plain one is
 * encrypted here before it is stored. Restoring is a separate, confirmed step
 * (restoreFromBackup), which also checks the file.
 */
export async function PUT(request: Request) {
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const declared = Number(request.headers.get("content-length"));
  if (!request.body || !declared) return NextResponse.json({ error: "No file received." }, { status: 400 });
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "The backup file is too large to upload (over 19 MB compressed)." }, { status: 413 });
  }

  // Read whole (at most 19 MB): it is encrypted as one piece. Counted as it
  // arrives, in case the declared length was wrong.
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > MAX_BYTES) {
        return NextResponse.json({ error: "The backup file is too large." }, { status: 413 });
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    return NextResponse.json({ error: "The file could not be uploaded. Please try again." }, { status: 400 });
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) return NextResponse.json({ error: "No file received." }, { status: 400 });

  const name = `upload-${Date.now()}.json.gz.enc`;
  try {
    await saveBackupFile(name, isEncryptedBackup(bytes) ? bytes : encryptBackup(bytes));
  } catch (err) {
    console.error("[backup upload] could not save", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The file could not be uploaded. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ name });
}

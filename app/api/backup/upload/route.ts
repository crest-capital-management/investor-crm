import { Readable, Transform, pipeline } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { getOwnerSessionId } from "@/lib/auth";
import { saveUploadedBackupFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The web server in front of the app accepts up to 20 MB; the browser compresses the file first.
const MAX_BYTES = 19 * 1024 * 1024;

/**
 * Receives a backup file the owner wants to restore from (gzipped by the
 * browser) and stores it in the private backups container. Restoring is a
 * separate, confirmed step (restoreFromBackup).
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

  // Counts the bytes as they arrive, in case the declared length was wrong.
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      done(received > MAX_BYTES ? new Error("File is too large.") : null, chunk);
    },
  });
  const body = pipeline(Readable.fromWeb(request.body as WebReadableStream<Uint8Array>), counter, () => {});

  const name = `upload-${Date.now()}.json.gz`;
  try {
    await saveUploadedBackupFile(name, body);
  } catch (err) {
    console.error("[backup upload] could not save", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: received > MAX_BYTES ? "The backup file is too large." : "The file could not be uploaded. Please try again." },
      { status: received > MAX_BYTES ? 413 : 500 },
    );
  }

  return NextResponse.json({ name });
}

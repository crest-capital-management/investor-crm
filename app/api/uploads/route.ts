import { Readable, Transform, pipeline } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { getOwnerSessionId } from "@/lib/auth";
import {
  MAX_UPLOAD_BYTES,
  PORTFOLIO_BUCKET,
  WHATSAPP_MEDIA_BUCKET,
  isFreshUploadPath,
  saveUploadedFile,
  type UploadBucket,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

const BUCKETS: UploadBucket[] = [WHATSAPP_MEDIA_BUCKET, PORTFOLIO_BUCKET];

/**
 * Receives a file from the browser and writes it to storage, so storage is
 * never opened to the browser. The address comes from prepareWhatsAppMediaUpload
 * / preparePortfolioUpload (which check the file first); here the owner, the
 * address and the size are checked again, and an existing file is never replaced.
 */
export async function PUT(request: Request) {
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const bucket = BUCKETS.find((b) => b === params.get("bucket"));
  const path = params.get("path") ?? "";
  if (!bucket || !isFreshUploadPath(path)) {
    return NextResponse.json({ error: "This upload link is not valid any more. Please try again." }, { status: 400 });
  }

  const limit = MAX_UPLOAD_BYTES[bucket];
  const declared = Number(request.headers.get("content-length"));
  if (!request.body || !declared) return NextResponse.json({ error: "No file received." }, { status: 400 });
  if (declared > limit) return NextResponse.json({ error: "File is too large." }, { status: 413 });

  // Counts the bytes as they arrive, in case the declared length was wrong.
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      done(received > limit ? new Error("File is too large.") : null, chunk);
    },
  });
  // pipeline passes a dropped connection on as an error, so the upload fails instead of hanging.
  const body = pipeline(Readable.fromWeb(request.body as WebReadableStream<Uint8Array>), counter, () => {});

  try {
    await saveUploadedFile(bucket, path, body, request.headers.get("content-type") || "application/octet-stream");
  } catch (err) {
    const tooLarge = received > limit;
    console.error("[uploads] could not save", bucket, err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: tooLarge ? "File is too large." : "The file could not be uploaded. Please try again." },
      { status: tooLarge ? 413 : 500 },
    );
  }

  return NextResponse.json({ path });
}

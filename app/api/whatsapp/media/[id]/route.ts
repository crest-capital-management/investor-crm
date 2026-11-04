import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/sql";
import { getOwnerSessionId } from "@/lib/auth";
import { storeInboundWhatsAppMedia } from "@/lib/inbound-media";
import { metaMediaIdFrom } from "@/lib/media-ref";
import { createSignedMediaUrl, mediaStoragePathFromUrl } from "@/lib/supabase-storage";

/** Our own stored file: a short-lived signed link. Anything else: the address as saved. */
async function openStoredUrl(mediaUrl: string) {
  const path = mediaStoragePathFromUrl(mediaUrl);
  const signed = path ? await createSignedMediaUrl(path) : null;
  return NextResponse.redirect(signed ?? mediaUrl);
}

export const dynamic = "force-dynamic";

/**
 * Opens the file attached to a WhatsApp message. Files received before the
 * CRM stored incoming media (saved as "meta_media_id:...") are downloaded from
 * Meta on first open, saved, and the message is updated to point at the copy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await getOwnerSessionId())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only the CRM owner gets here (checked above). A malformed id simply finds no message.
  let message: { id: string; media_url: string | null } | null = null;
  try {
    message = isUuid(id)
      ? await db.maybeOne<{ id: string; media_url: string | null }>(
          "select id, media_url from whatsapp_messages where id = $1::uuid",
          [id],
        )
      : null;
  } catch {
    message = null;
  }

  const mediaUrl = message?.media_url;
  if (!mediaUrl) {
    return new NextResponse("This message has no attachment.", { status: 404 });
  }

  const mediaId = metaMediaIdFrom(mediaUrl);
  if (!mediaId) {
    return openStoredUrl(mediaUrl);
  }

  try {
    const storedUrl = await storeInboundWhatsAppMedia(mediaId);
    await db.execute("update whatsapp_messages set media_url = $1 where id = $2::uuid", [storedUrl, id]);
    return openStoredUrl(storedUrl);
  } catch {
    return new NextResponse(
      "This file is no longer available. WhatsApp keeps received files for about 30 days.",
      { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

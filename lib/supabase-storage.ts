import { createServiceRoleClient } from "@/lib/supabase-service";

const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

/**
 * Uploads a file's bytes to the whatsapp-media storage bucket and returns
 * its public URL, so sent/received WhatsApp media can be displayed later in
 * the CRM without depending on Meta's short-lived, authenticated media URLs.
 */
export async function uploadWhatsAppMediaToStorage(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  contactId: string,
): Promise<string> {
  const supabase = createServiceRoleClient();

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${contactId}/${Date.now()}-${safeFilename}`;

  const { error } = await supabase.storage
    .from(WHATSAPP_MEDIA_BUCKET)
    .upload(path, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to store media file: ${error.message}`);
  }

  const { data } = supabase.storage.from(WHATSAPP_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

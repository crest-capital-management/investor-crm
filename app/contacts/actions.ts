"use server";

import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isReplyWindowOpen } from "@/lib/reply-window";
import { revalidatePath } from "next/cache";
import { generateChatSummary, transcribeVoiceNoteToMeetingNote } from "@/lib/gemini";
import {
  mimeTypeToWhatsAppMediaType,
  normalizeToLocalPhone,
  sendWhatsAppMediaMessage,
  sendWhatsAppMessage,
  sendWhatsAppTemplateMessage,
  uploadWhatsAppMedia,
} from "@/lib/whatsapp";
import {
  createMediaUploadTarget,
  downloadStoredMedia,
  mediaStoragePathFromUrl,
  mediaUrlForPath,
} from "@/lib/supabase-storage";
import { param } from "@/lib/sql";
import { TAG_OPTIONS } from "@/lib/tags";
import { parseTagCell } from "@/lib/tag-match";
import { parseExcelBuffer, type ParsedSpreadsheet } from "@/lib/parse-spreadsheet";
import { linkUnmatchedMessages } from "@/lib/link-messages";
import { insertOutboundMessage, type SavedMessage } from "@/lib/message-status";

// The live host (Netlify) rejects requests over about 6MB, so keep these under that.
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

const DUPLICATE_PHONE_ERROR =
  "This phone number is already associated with another contact.";

// Saved and compared in one canonical form so 919876543210, +91 98765 43210,
// 09876543210 and 9876543210 are all the same number (Indian numbers are kept
// as 10 digits; foreign numbers stay whole).
function normalizePhone(value: string) {
  return normalizeToLocalPhone(value) ?? "";
}

async function fetchAllContactPhones(
  options: { excludeId?: string; excludeDeleted?: boolean } = {}
): Promise<string[]> {
  const { excludeId, excludeDeleted = true } = options;

  const params: unknown[] = [];
  const conditions: string[] = [];
  if (excludeDeleted) conditions.push("deleted_at is null");
  if (excludeId) conditions.push(`id <> ${param(params, excludeId)}`);

  const rows = await db.query<{ phone: string }>(
    `select phone from public.contacts${conditions.length ? ` where ${conditions.join(" and ")}` : ""}`,
    params,
  );

  return rows.map((row) => String(row.phone));
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string) {
  return EMAIL_REGEX.test(value);
}

export async function addContact(formData: FormData) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const name = formData.get("name") as string;
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const emailRaw = String(formData.get("email") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const tagsRaw = formData.get("tags") as string;
  const dateSaved = formData.get("dateSaved") as string;
  const notes = String(formData.get("notes") ?? "").trim();

  let tags: string[] = [];
  try {
    tags = tagsRaw ? JSON.parse(tagsRaw) : [];
  } catch {
    tags = [];
  }

  if (!name || !phone) {
    return { error: "Name and phone are required." };
  }

  if (!/^\d{7,15}$/.test(phone)) {
    return { error: "Phone must contain 7-15 digits." };
  }

  // Email is optional (e.g. saving someone who only messaged on WhatsApp).
  if (emailRaw && !isValidEmail(emailRaw)) {
    return { error: "Please enter a valid email address." };
  }
  const normalizedEmail = emailRaw ? emailRaw.toLowerCase() : null;

  if (dateSaved && !isValidDate(dateSaved)) {
    return { error: "Date must use a valid YYYY-MM-DD date." };
  }

  let existingPhones: string[];
  try {
    existingPhones = await fetchAllContactPhones();
  } catch {
    return { error: "The contact could not be checked for duplicates." };
  }

  if (existingPhones.some((existingPhone) => normalizePhone(existingPhone) === phone)) {
    return { error: DUPLICATE_PHONE_ERROR };
  }

  let inserted: { id: string; phone: string };
  try {
    inserted = await db.one<{ id: string; phone: string }>(
      `insert into public.contacts (name, phone, email, company, tags, date_saved, notes)
       values ($1, $2, $3, $4, $5::text[], $6, $7)
       returning id, phone`,
      [name, phone, normalizedEmail, company || null, tags, dateSaved || null, notes || null],
    );
  } catch (error) {
    console.error("[addContact] insert failed:", error instanceof Error ? error.message : error);
    return { error: "The contact could not be saved. Please try again." };
  }

  await linkUnmatchedMessages([inserted]);

  revalidatePath("/contacts");
  revalidatePath("/unread-messages");
  return { success: true };
}

export async function updateContact(id: string, formData: FormData) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const emailRaw = String(formData.get("email") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "");
  const dateSaved = String(formData.get("dateSaved") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  let tags: string[] = [];
  try {
    const parsedTags: unknown = tagsRaw ? JSON.parse(tagsRaw) : [];
    tags = Array.isArray(parsedTags)
      ? parsedTags.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return { error: "Tags could not be processed." };
  }

  if (!name || !phone) {
    return { error: "Name and phone are required." };
  }

  if (!/^\d{7,15}$/.test(phone)) {
    return { error: "Phone must contain 7-15 digits." };
  }

  // Email is optional (e.g. saving someone who only messaged on WhatsApp).
  if (emailRaw && !isValidEmail(emailRaw)) {
    return { error: "Please enter a valid email address." };
  }
  const normalizedEmail = emailRaw ? emailRaw.toLowerCase() : null;

  if (dateSaved && !isValidDate(dateSaved)) {
    return { error: "Date must use a valid YYYY-MM-DD date." };
  }

  let duplicate: { id: string } | null;
  try {
    duplicate = await db.maybeOne<{ id: string }>(
      "select id from public.contacts where phone = $1 and id <> $2 and deleted_at is null limit 1",
      [phone, id],
    );
  } catch {
    return { error: "The contact could not be checked for duplicates." };
  }

  if (duplicate) {
    return { error: DUPLICATE_PHONE_ERROR };
  }

  let otherPhones: string[];
  try {
    otherPhones = await fetchAllContactPhones({ excludeId: id });
  } catch {
    return { error: "The contact could not be checked for duplicates." };
  }

  if (otherPhones.some((otherPhone) => normalizePhone(otherPhone) === phone)) {
    return { error: DUPLICATE_PHONE_ERROR };
  }

  try {
    await db.execute(
      `update public.contacts
          set name = $2, phone = $3, email = $4, company = $5, tags = $6::text[], date_saved = $7, notes = $8
        where id = $1`,
      [id, name, phone, normalizedEmail, company || null, tags, dateSaved || null, notes || null],
    );
  } catch {
    return { error: "The contact could not be updated." };
  }

  // A corrected phone number may match messages that arrived unmatched.
  await linkUnmatchedMessages([{ id, phone }]);

  revalidatePath("/contacts");
  return { success: true };
}

const CONTACT_TAG_OPTIONS = TAG_OPTIONS;

async function findContactTags(id: string): Promise<{ id: string; tags: string[] | null } | null> {
  try {
    return await db.maybeOne<{ id: string; tags: string[] | null }>("select id, tags from public.contacts where id = $1", [id]);
  } catch {
    return null;
  }
}

async function findContactPhone(id: string): Promise<{ id: string; phone: string } | null> {
  try {
    return await db.maybeOne<{ id: string; phone: string }>("select id, phone from public.contacts where id = $1", [id]);
  } catch {
    return null;
  }
}

/** Runs a query and returns its rows, or null when it fails (so the caller can show its own message). */
async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/** True when the contact exists (a soft-deleted one counts, as before). */
async function contactExists(id: string): Promise<boolean> {
  try {
    return (await db.maybeOne<{ id: string }>("select id from public.contacts where id = $1", [id])) !== null;
  } catch {
    return false;
  }
}

export async function addTagToContact(id: string, tag: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedTag = tag.trim();
  if (!id.trim()) return { error: "The contact could not be found." };
  if (!CONTACT_TAG_OPTIONS.includes(normalizedTag)) return { error: "That tag is not available." };

  const contact = await findContactTags(id);
  if (!contact) return { error: "The contact could not be found." };

  const tags = Array.isArray(contact.tags) ? contact.tags.filter((value): value is string => typeof value === "string") : [];
  if (tags.some((value) => value.toLowerCase() === normalizedTag.toLowerCase())) {
    return { error: "That tag is already assigned to this contact." };
  }

  const updatedTags = [...tags, normalizedTag];
  try {
    await db.execute("update public.contacts set tags = $2::text[] where id = $1", [id, updatedTags]);
  } catch {
    return { error: "The tag could not be added." };
  }

  revalidatePath("/contacts");
  return { success: true, tags: updatedTags };
}

/** Removes one tag from a contact; its other tags are kept. */
export async function removeTagFromContact(id: string, tag: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedTag = tag.trim();
  if (!id.trim() || !normalizedTag) return { error: "The contact could not be found." };

  const contact = await findContactTags(id);
  if (!contact) return { error: "The contact could not be found." };

  const tags = Array.isArray(contact.tags)
    ? contact.tags.filter((value): value is string => typeof value === "string")
    : [];
  const updatedTags = tags.filter((value) => value.toLowerCase() !== normalizedTag.toLowerCase());
  if (updatedTags.length === tags.length) return { error: "That tag is not on this contact." };

  try {
    await db.execute("update public.contacts set tags = $2::text[] where id = $1", [id, updatedTags]);
  } catch {
    return { error: "The tag could not be removed." };
  }

  revalidatePath("/contacts");
  revalidatePath("/investors");
  return { success: true, tags: updatedTags };
}

export async function addMeetingNote(contactId: string, note: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  const normalizedNote = note.trim();

  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!normalizedNote) return { error: "Meeting note is required." };

  if (!(await contactExists(normalizedContactId))) return { error: "The contact could not be found." };

  try {
    await db.execute("insert into public.interactions (contact_id, type, note) values ($1, 'meeting', $2)", [
      normalizedContactId,
      normalizedNote,
    ]);
  } catch {
    return { error: "The meeting note could not be saved." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

const MAX_VOICE_NOTE_BYTES = 5 * 1024 * 1024; // the live host rejects requests over about 6MB

export type TranscribeVoiceNoteResult =
  | { success: true; transcript: string }
  | { error: string };

/**
 * Transcribes an uploaded voice note recording into a meeting note draft
 * using Gemini's audio understanding. Only returns the drafted text — it is
 * not saved until the user reviews and confirms it via the normal Add
 * Meeting Note dialog. The audio file itself is not stored anywhere.
 */
export async function transcribeVoiceNote(
  contactId: string,
  file: File,
): Promise<TranscribeVoiceNoteResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  if (!file || file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_VOICE_NOTE_BYTES) {
    return { error: "File is too large. Please choose a recording under 5MB." };
  }
  if (!file.type.startsWith("audio/")) {
    return { error: `Unsupported file type: ${file.type || "unknown"}. Please upload an audio file.` };
  }

  if (!(await contactExists(normalizedContactId))) return { error: "The contact could not be found." };

  let audioBuffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
  } catch {
    return { error: "Could not read the selected file." };
  }

  try {
    const transcript = await transcribeVoiceNoteToMeetingNote(audioBuffer, file.type);
    return { success: true, transcript };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to transcribe the voice note.";
    return { error: msg };
  }
}

export type MeetingNote = {
  id: string;
  note: string;
  created_at: string;
};

export async function getMeetingNotes(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  try {
    const notes = await db.query<MeetingNote>(
      `select id, note, created_at from public.interactions
        where contact_id = $1 and type = 'meeting' and deleted_at is null
        order by created_at desc`,
      [normalizedContactId],
    );
    return { notes };
  } catch {
    return { error: "Meeting notes could not be loaded." };
  }
}

export type SendWhatsAppReplyResult =
  | { success: true; message?: SavedMessage }
  | { error: string };

const REPLY_WINDOW_CLOSED_ERROR =
  "This contact hasn't messaged you in the last 24 hours, so WhatsApp won't deliver a normal message. Send an approved Meta template instead.";

/**
 * Sends a free-form WhatsApp reply to a contact directly from the CRM and
 * logs it in whatsapp_messages as an outbound message. Subject to Meta's
 * 24-hour customer service window: this will fail with a clear error if the
 * contact hasn't messaged in via WhatsApp recently.
 */
export async function sendWhatsAppReply(
  contactId: string,
  message: string,
): Promise<SendWhatsAppReplyResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  const normalizedMessage = message.trim();

  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!normalizedMessage) return { error: "Message cannot be empty." };

  const contact = await findContactPhone(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  if (!(await isReplyWindowOpen(normalizedContactId))) {
    return { error: REPLY_WINDOW_CLOSED_ERROR };
  }

  let wamid: string | undefined;
  try {
    const response = await sendWhatsAppMessage({
      to: contact.phone,
      message: normalizedMessage,
    });

    if (response.error) {
      return { error: response.error.message || "WhatsApp could not send this message." };
    }
    wamid = response.messages?.[0]?.id;
  } catch (err: unknown) {
    const messageText =
      err instanceof Error ? err.message : "WhatsApp could not send this message.";
    return { error: messageText };
  }

  const { error: insertError, message: savedMessage } = await insertOutboundMessage(
    { contact_id: normalizedContactId, message_text: normalizedMessage },
    wamid,
  );

  if (insertError) {
    // Message was sent via Meta but failed to log locally; surface this so
    // it isn't silently missing from history.
    return { error: "Message sent, but could not be saved to WhatsApp history." };
  }

  // No page re-render here: the chat adds the saved message itself, so the reply isn't slowed down.
  return { success: true, message: savedMessage };
}

/**
 * Sends a Meta-approved template to one contact. Unlike a plain reply, this
 * works even when the contact hasn't messaged in the last 24 hours.
 * `params` fills the body's {{1}}, {{2}}, ... in order.
 */
export async function sendWhatsAppTemplateToContact(
  contactId: string,
  templateId: string,
  params: string[],
): Promise<SendWhatsAppReplyResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const contact = await attempt(() =>
    db.maybeOne<{ id: string; phone: string }>(
      "select id, phone from public.contacts where id = $1 and deleted_at is null",
      [contactId.trim()],
    ),
  );
  if (!contact) return { error: "The contact could not be found." };

  type TemplateRow = { name: string; language: string; body_text: string; meta_template_id: string | null; approved_at: string | null };
  const template = await attempt(() =>
    db.maybeOne<TemplateRow>(
      `select name, language, body_text, meta_template_id, approved_at
         from public.templates
        where id = $1 and deleted_at is null`,
      [templateId],
    ),
  );
  if (!template || !template.meta_template_id) {
    return { error: "The template could not be found. Try \"Sync from Meta\" on the Templates page." };
  }
  if (!template.approved_at) {
    return { error: `Template "${template.name}" is not approved by Meta yet.` };
  }

  const placeholders = Array.from(
    new Set(Array.from((template.body_text as string).matchAll(/\{\{(\d+)\}\}/g), (m) => m[1])),
  ).sort((a, b) => Number(a) - Number(b));
  const values = params.map((value) => (value ?? "").trim());
  if (values.length !== placeholders.length || values.some((value) => !value)) {
    return { error: "Please fill in every variable before sending." };
  }

  let wamid: string | undefined;
  try {
    const response = await sendWhatsAppTemplateMessage({
      to: contact.phone,
      templateName: template.name,
      language: template.language,
      bodyParameters: values,
    });
    wamid = response.messages?.[0]?.id;
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : "WhatsApp could not send this template.",
    };
  }

  let sentText = template.body_text as string;
  placeholders.forEach((ph, index) => {
    sentText = sentText.replaceAll(`{{${ph}}}`, values[index]);
  });

  const { error: insertError, message: savedMessage } = await insertOutboundMessage(
    { contact_id: contact.id, message_text: sentText },
    wamid,
  );
  if (insertError) {
    return { error: "Template sent, but could not be saved to WhatsApp history." };
  }

  // No page re-render here: the chat adds the saved message itself, so the reply isn't slowed down.
  return { success: true, message: savedMessage };
}

const MAX_WHATSAPP_MEDIA_BYTES = 16 * 1024 * 1024; // 16MB, matches Meta's video/audio limit

export type SendWhatsAppMediaReplyResult =
  | { success: true; message?: SavedMessage }
  | { error: string };

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", "3gp": "video/3gpp", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", amr: "audio/amr", wav: "audio/wav",
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain",
};

/**
 * Sends again a message that WhatsApp reported as not delivered. It goes out as
 * a new message (the failed one stays in the history, marked as resent so it
 * can't be resent twice). Works only while the 24-hour reply window is open;
 * otherwise an approved template is needed.
 */
export async function resendFailedWhatsAppMessage(messageId: string): Promise<SendWhatsAppReplyResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  type OriginalRow = {
    id: string;
    contact_id: string | null;
    direction: string | null;
    message_text: string | null;
    media_url: string | null;
    status: string | null;
    status_error: string | null;
    deleted_at: string | null;
  };
  const original = await attempt(() =>
    db.maybeOne<OriginalRow>(
      `select id, contact_id, direction, message_text, media_url, status, status_error, deleted_at
         from public.whatsapp_messages where id = $1`,
      [messageId],
    ),
  );
  if (!original || original.deleted_at) return { error: "That message could not be found." };
  if (original.direction !== "out" || original.status !== "failed" || !original.contact_id) {
    return { error: "Only a message that was not delivered can be resent." };
  }
  if (/^Resent\b/.test(original.status_error ?? "")) {
    return { error: "This message has already been resent." };
  }

  const contactId = original.contact_id as string;
  const contact = await findContactPhone(contactId);
  if (!contact) return { error: "The contact could not be found." };

  if (!(await isReplyWindowOpen(contactId))) {
    return { error: REPLY_WINDOW_CLOSED_ERROR };
  }

  let wamid: string | undefined;
  try {
    if (original.media_url) {
      const path = mediaStoragePathFromUrl(original.media_url);
      if (!path) return { error: "This attachment can't be resent. Please attach the file again." };
      const filename = (path.split("/").pop() ?? "file").replace(/^\d+-/, "");
      const extension = filename.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = MIME_BY_EXTENSION[extension];
      const mediaType = mimeType ? mimeTypeToWhatsAppMediaType(mimeType) : null;
      if (!mimeType || !mediaType) return { error: "This attachment can't be resent. Please attach the file again." };
      const bytes = await downloadStoredMedia(path);
      const mediaId = await uploadWhatsAppMedia(bytes, mimeType, filename);
      const response = await sendWhatsAppMediaMessage({
        to: contact.phone,
        mediaId,
        mediaType,
        filename,
        caption: original.message_text?.trim() || undefined,
      });
      wamid = response.messages?.[0]?.id;
    } else {
      const text = (original.message_text ?? "").trim();
      if (!text) return { error: "There is nothing to resend." };
      const response = await sendWhatsAppMessage({ to: contact.phone, message: text });
      if (response.error) return { error: response.error.message || "WhatsApp could not send this message." };
      wamid = response.messages?.[0]?.id;
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "WhatsApp could not send this message." };
  }

  const { error: insertError, message: savedMessage } = await insertOutboundMessage(
    { contact_id: contactId, message_text: original.message_text, media_url: original.media_url },
    wamid,
  );
  // Mark the failed one so it can't be resent again (it stays in the history).
  await attempt(() =>
    db.execute("update public.whatsapp_messages set status_error = $2 where id = $1 and status = 'failed'", [
      original.id,
      `Resent. Original problem: ${original.status_error ?? "not delivered"}`,
    ]),
  );
  if (insertError) return { error: "Message sent, but could not be saved to WhatsApp history." };

  // No page re-render here: the chat adds the saved message itself, so the reply isn't slowed down.
  return { success: true, message: savedMessage };
}

/**
 * Step 1 of sending a file: checks it and returns a one-time upload address so
 * the browser can send the file straight to storage. Going around the web
 * server avoids its request-size cap, so files up to Meta's 16 MB limit work.
 */
export async function prepareWhatsAppMediaUpload(
  contactId: string,
  filename: string,
  mimeType: string,
  size: number,
): Promise<{ path: string; token: string } | { error: string }> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!size) return { error: "No file selected." };
  if (size > MAX_WHATSAPP_MEDIA_BYTES) {
    return { error: "File is too large. Please choose a file under 16MB." };
  }
  if (!mimeTypeToWhatsAppMediaType(mimeType)) {
    return { error: `Unsupported file type: ${mimeType || "unknown"}.` };
  }

  if (!(await contactExists(normalizedContactId))) return { error: "The contact could not be found." };

  if (!(await isReplyWindowOpen(normalizedContactId))) {
    return { error: REPLY_WINDOW_CLOSED_ERROR };
  }

  try {
    return await createMediaUploadTarget(normalizedContactId, filename);
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Could not prepare the upload." };
  }
}

/**
 * Step 2: the file is already in storage (uploaded by the browser). Reads it,
 * hands it to WhatsApp, sends it and records it in the chat history.
 */
export async function sendWhatsAppMediaFromStorage(
  contactId: string,
  path: string,
  mimeType: string,
  filename: string,
  caption?: string,
): Promise<SendWhatsAppMediaReplyResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };
  // Only files uploaded for this contact by step 1 can be sent.
  if (!path.startsWith(`${normalizedContactId}/`) || path.includes("..")) {
    return { error: "That file isn't available for this contact." };
  }

  const mediaType = mimeTypeToWhatsAppMediaType(mimeType);
  if (!mediaType) return { error: `Unsupported file type: ${mimeType || "unknown"}.` };

  const contact = await findContactPhone(normalizedContactId);
  if (!contact) return { error: "The contact could not be found." };

  if (!(await isReplyWindowOpen(normalizedContactId))) {
    return { error: REPLY_WINDOW_CLOSED_ERROR };
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await downloadStoredMedia(path);
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Could not read the uploaded file." };
  }
  if (fileBuffer.length === 0 || fileBuffer.length > MAX_WHATSAPP_MEDIA_BYTES) {
    return { error: "File is too large. Please choose a file under 16MB." };
  }

  let wamid: string | undefined;
  try {
    const mediaId = await uploadWhatsAppMedia(fileBuffer, mimeType, filename);
    const response = await sendWhatsAppMediaMessage({
      to: contact.phone,
      mediaId,
      mediaType,
      filename,
      caption: caption?.trim() || undefined,
    });
    wamid = response.messages?.[0]?.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "WhatsApp could not send this file.";
    return { error: msg };
  }

  const { error: insertError, message: savedMessage } = await insertOutboundMessage(
    {
      contact_id: normalizedContactId,
      message_text: caption?.trim() || null,
      media_url: mediaUrlForPath(path),
    },
    wamid,
  );

  if (insertError) {
    return { error: "File sent, but could not be saved to WhatsApp history." };
  }

  // No page re-render here: the chat adds the saved message itself, so the reply isn't slowed down.
  return { success: true, message: savedMessage };
}

export async function updateMeetingNote(
  noteId: string,
  contactId: string,
  note: string,
) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedNoteId = noteId.trim();
  const normalizedContactId = contactId.trim();
  const normalizedNote = note.trim();

  if (!normalizedNoteId) return { error: "Invalid note ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };
  if (!normalizedNote) return { error: "Meeting note is required." };

  if (!(await contactExists(normalizedContactId))) return { error: "The contact could not be found." };

  // Verify interaction exists, belongs to contact, and is strictly of type 'meeting'
  const interaction = await attempt(() =>
    db.maybeOne<{ id: string; contact_id: string | null; type: string }>(
      "select id, contact_id, type from public.interactions where id = $1",
      [normalizedNoteId],
    ),
  );

  if (!interaction) return { error: "Meeting note not found." };
  if (interaction.contact_id !== normalizedContactId) {
    return { error: "Meeting note does not belong to this contact." };
  }
  if (interaction.type !== "meeting") {
    return { error: "Only meeting notes can be edited." };
  }

  // Update only the note text. Preserves created_at, contact_id, type, id.
  try {
    await db.execute(
      "update public.interactions set note = $3 where id = $1 and contact_id = $2 and type = 'meeting'",
      [normalizedNoteId, normalizedContactId, normalizedNote],
    );
  } catch {
    return { error: "The meeting note could not be updated." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export async function deleteMeetingNote(noteId: string, contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedNoteId = noteId.trim();
  const normalizedContactId = contactId.trim();

  if (!normalizedNoteId) return { error: "Invalid note ID." };
  if (!normalizedContactId) return { error: "The contact could not be found." };

  if (!(await contactExists(normalizedContactId))) return { error: "The contact could not be found." };

  // Verify interaction exists, belongs to contact, and is strictly of type 'meeting'
  const interaction = await attempt(() =>
    db.maybeOne<{ id: string; contact_id: string | null; type: string }>(
      "select id, contact_id, type from public.interactions where id = $1",
      [normalizedNoteId],
    ),
  );

  if (!interaction) return { error: "Meeting note not found." };
  if (interaction.contact_id !== normalizedContactId) {
    return { error: "Meeting note does not belong to this contact." };
  }
  if (interaction.type !== "meeting") {
    return { error: "Only meeting notes can be deleted." };
  }

  // Strictly soft-delete where id = noteId, contact_id = contactId, and type = 'meeting'
  // NEVER allow deleting type = 'follow_up'
  try {
    await db.execute(
      "update public.interactions set deleted_at = $3 where id = $1 and contact_id = $2 and type = 'meeting'",
      [normalizedNoteId, normalizedContactId, new Date().toISOString()],
    );
  } catch {
    return { error: "The meeting note could not be deleted." };
  }

  revalidatePath("/investors");
  revalidatePath(`/investors/${normalizedContactId}`);
  return { success: true };
}

export type ContactGroupOption = { id: string; name: string };

export async function getContactGroupOptions(contactId: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  if (!contactId.trim()) return { error: "The contact could not be found." };

  const [contactFound, groups, memberships] = await Promise.all([
    attempt(() => contactExists(contactId)),
    attempt(() => db.query<ContactGroupOption>("select id, name from public.groups order by name asc")),
    attempt(() => db.query<{ group_id: string }>("select group_id from public.contact_groups where contact_id = $1", [contactId])),
  ]);

  if (!contactFound) return { error: "The contact could not be found." };
  if (!groups || !memberships) return { error: "Groups could not be loaded." };

  const memberIds = new Set(memberships.map((membership) => membership.group_id));
  return {
    groups: groups.filter((group) => !memberIds.has(group.id)),
  };
}

export async function addContactToGroups(contactId: string, groupIds: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedGroupIds = [...new Set(groupIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!contactId.trim()) return { error: "The contact could not be found." };
  if (!normalizedGroupIds.length) return { error: "No groups were selected." };

  const [contactFound, groups, memberships] = await Promise.all([
    attempt(() => contactExists(contactId)),
    attempt(() => db.query<{ id: string; name: string }>("select id, name from public.groups where id = any($1::uuid[])", [normalizedGroupIds])),
    attempt(() =>
      db.query<{ group_id: string }>(
        "select group_id from public.contact_groups where contact_id = $1 and group_id = any($2::uuid[])",
        [contactId, normalizedGroupIds],
      ),
    ),
  ]);

  if (!contactFound) return { error: "The contact could not be found." };
  if (!groups || groups.length !== normalizedGroupIds.length) return { error: "One or more selected groups could not be found." };
  if (!memberships) return { error: "Group memberships could not be checked." };

  const existingIds = new Set(memberships.map((membership) => membership.group_id));
  const newGroupIds = normalizedGroupIds.filter((id) => !existingIds.has(id));
  if (newGroupIds.length) {
    try {
      await db.execute(
        "insert into public.contact_groups (contact_id, group_id) select $1::uuid, unnest($2::uuid[])",
        [contactId, newGroupIds],
      );
    } catch {
      return { error: "The contact could not be added to the groups." };
    }
  }

  // Same shape as before: [{ groups: { id, name } }].
  let updatedMemberships: Array<{ groups: { id: string; name: string } }>;
  try {
    updatedMemberships = await db.query<{ groups: { id: string; name: string } }>(
      `select json_build_object('id', g.id, 'name', g.name) as groups
         from public.contact_groups cg
         join public.groups g on g.id = cg.group_id
        where cg.contact_id = $1`,
      [contactId],
    );
  } catch {
    return { error: "The contact groups could not be refreshed." };
  }

  revalidatePath("/contacts");
  revalidatePath("/groups");
  return {
    success: true,
    added: newGroupIds.length,
    groups: updatedMemberships,
  };
}

export async function deleteContact(id: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  try {
    await db.execute("update public.contacts set deleted_at = $2 where id = $1", [id, new Date().toISOString()]);
  } catch {
    return { error: "The contact could not be deleted." };
  }

  revalidatePath("/contacts");
  return { success: true };
}

export async function deleteContacts(ids: string[]) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const contactIds = [...new Set(ids.filter(Boolean))];

  if (!contactIds.length) {
    return { error: "No contacts were selected." };
  }

  // Soft delete, like single delete: the contacts are hidden everywhere
  // (groups skip deleted members), but their notes, follow-ups, messages and
  // group memberships stay in the database. There is no restore action yet.
  const deletedAt = new Date().toISOString();
  try {
    await db.execute("update public.contacts set deleted_at = $2 where id = any($1::uuid[]) and deleted_at is null", [
      contactIds,
      deletedAt,
    ]);
  } catch {
    return { error: "The selected contacts could not be deleted." };
  }

  revalidatePath("/contacts");
  return { success: true, deleted: contactIds.length };
}

export type ImportContactRow = {
  name: string;
  phone: string;
  email?: string | null;
  company?: string;
  tag: string;
  dateSaved: string;
  notes: string;
};

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(value.slice(0, 4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getUTCDate() === Number(value.slice(8, 10))
  );
}

function validateImportRow(row: ImportContactRow) {
  if (!row.name || !row.phone) {
    return "Name and phone are required.";
  }

  if (!/^\d{7,15}$/.test(row.phone)) {
    return "Phone must contain 7-15 digits.";
  }

  if (row.email && !isValidEmail(row.email)) {
    return "Please enter a valid email address.";
  }

  if (row.dateSaved && !isValidDate(row.dateSaved)) {
    return "Date Saved must use a valid YYYY-MM-DD date.";
  }

  const unknownTag = row.tag ? parseTagCell(row.tag).unknown : undefined;
  if (unknownTag) {
    return `Unknown tag "${unknownTag}".`;
  }

  return null;
}

export type ImportDuplicateRow = {
  name: string;
  phone: string;
  email: string | null;
  reason: string;
};

export type ImportContactsResult =
  | {
      success: true;
      imported: number;
      duplicates: number;
      /** Rows skipped because the phone is already a contact (these can be updated instead). */
      existing: number;
      rejected: number;
      duplicateRows: ImportDuplicateRow[];
    }
  | { error: string };

// Insert in batches rather than one giant array so a single failure only
// stops the rows after it (already-inserted batches stay committed) and so
// we can report exactly how far an import got if something does fail.
const IMPORT_INSERT_BATCH_SIZE = 300;

export async function importContacts(rowsRaw: string): Promise<ImportContactsResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  let rows: ImportContactRow[];

  try {
    const parsedRows: unknown = JSON.parse(rowsRaw);
    if (!Array.isArray(parsedRows)) throw new Error("Invalid rows");
    rows = parsedRows.map((row) => {
      const rowObj = row as ImportContactRow;
      const emailRaw = rowObj.email !== undefined && rowObj.email !== null
        ? String(rowObj.email).trim()
        : "";
      return {
        name: String(rowObj.name ?? "").trim(),
        phone: String(rowObj.phone ?? "").trim(),
        email: emailRaw || null,
        company: String(rowObj.company ?? "").trim(),
        tag: String(rowObj.tag ?? "").trim(),
        dateSaved: String(rowObj.dateSaved ?? "").trim(),
        notes: String(rowObj.notes ?? "").trim(),
      };
    });
  } catch {
    return { error: "The CSV data could not be processed." };
  }

  if (!rows.length) {
    return { error: "The CSV file does not contain any rows." };
  }

  const validRows = rows.filter((row) => !validateImportRow(row));
  const rejected = rows.length - validRows.length;

  let existingPhonesList: string[];
  try {
    // Matches the original behavior of this lookup: existing AND
    // soft-deleted contacts both count as "already taken" phone numbers.
    existingPhonesList = await fetchAllContactPhones({ excludeDeleted: false });
  } catch {
    return { error: "Contacts could not be checked for duplicates." };
  }

  const existingPhones = new Set(existingPhonesList.map((phone) => normalizePhone(phone)));
  // The first row for each new phone, with the tags of any later rows for that phone merged in.
  const seenPhones = new Map<string, { name: string; tags: string[] }>();
  const rowsToInsert: Array<ImportContactRow & { tags: string[] }> = [];
  const duplicateRows: ImportDuplicateRow[] = [];
  let existing = 0;

  for (const row of validRows) {
    const normalizedPhone = normalizePhone(row.phone);

    if (existingPhones.has(normalizedPhone)) {
      existing++;
      duplicateRows.push({
        name: row.name,
        phone: row.phone,
        email: row.email ?? null,
        reason: "Phone already exists in the CRM",
      });
      continue;
    }

    const rowTags = row.tag ? parseTagCell(row.tag).tags : [];
    const firstSeen = seenPhones.get(normalizedPhone);
    if (firstSeen) {
      for (const tag of rowTags) {
        if (!firstSeen.tags.includes(tag)) firstSeen.tags.push(tag);
      }
      duplicateRows.push({
        name: row.name,
        phone: row.phone,
        email: row.email ?? null,
        reason: `Duplicate phone number within this file (same as "${firstSeen.name}"; tags combined)`,
      });
      continue;
    }

    const pendingRow = { ...row, tags: rowTags };
    seenPhones.set(normalizedPhone, { name: row.name, tags: pendingRow.tags });
    rowsToInsert.push(pendingRow);
  }

  for (let i = 0; i < rowsToInsert.length; i += IMPORT_INSERT_BATCH_SIZE) {
    const batch = rowsToInsert.slice(i, i + IMPORT_INSERT_BATCH_SIZE).map((row) => ({
      name: row.name,
      phone: normalizePhone(row.phone),
      email: row.email ? row.email.toLowerCase() : null,
      company: row.company || null,
      tags: row.tags,
      date_saved: row.dateSaved || null,
      notes: row.notes || null,
    }));

    // One statement per batch, so a batch is saved completely or not at all.
    let insertedRows: Array<{ id: string; phone: string }> | null = null;
    try {
      insertedRows = await db.query<{ id: string; phone: string }>(
        `insert into public.contacts (name, phone, email, company, tags, date_saved, notes)
         select x.name, x.phone, x.email, x.company, x.tags, x.date_saved, x.notes
           from jsonb_to_recordset($1::jsonb) as x(
             name text, phone text, email text, company text, tags text[], date_saved date, notes text
           )
         returning id, phone`,
        [JSON.stringify(batch)],
      );
    } catch {
      insertedRows = null;
    }

    if (insertedRows) {
      await linkUnmatchedMessages(insertedRows);
    } else {
      revalidatePath("/contacts");
      return {
        error: `Import stopped after ${i} of ${rowsToInsert.length} new contacts. The ${i} contacts already inserted were saved — try again to import the rest.`,
      };
    }
  }

  revalidatePath("/contacts");
  return {
    success: true,
    imported: rowsToInsert.length,
    duplicates: duplicateRows.length,
    existing,
    rejected,
    duplicateRows,
  };
}

export type ParseExcelFileResult = ParsedSpreadsheet | { error: string };

/**
 * Parses an uploaded Excel (.xlsx/.xls) file into the same
 * { headers, rows } shape the client already uses for CSV, so it can reuse
 * the existing column-mapping and validation UI.
 */
export async function parseExcelFile(file: File): Promise<ParseExcelFileResult> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  if (!file || file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { error: "File is too large. Please choose a file under 5MB." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    return await parseExcelBuffer(buffer);
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : "The Excel file could not be read.",
    };
  }
}

export type GenerateWhatsAppSummaryResult =
  | {
      success: true;
      summary: string;
      generatedAt: string;
    }
  | {
      error: string;
    };

export async function generateWhatsAppSummary(
  contactId: string
): Promise<GenerateWhatsAppSummaryResult> {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const normalizedContactId = contactId.trim();
  if (!normalizedContactId) return { error: "The contact could not be found." };

  try {
    let messages: Parameters<typeof generateChatSummary>[0];
    try {
      messages = await db.query(
        `select * from public.whatsapp_messages
          where contact_id = $1 and deleted_at is null
          order by sent_at asc`,
        [normalizedContactId],
      );
    } catch {
      return { error: "WhatsApp messages could not be loaded." };
    }

    if (messages.length === 0) {
      return { error: "No WhatsApp messages found to summarize." };
    }

    const summary = await generateChatSummary(messages);
    const nowIso = new Date().toISOString();

    try {
      await db.execute(
        "update public.contacts set whatsapp_summary = $2, whatsapp_summary_generated_at = $3 where id = $1",
        [normalizedContactId, summary, nowIso],
      );
    } catch {
      return { error: "Failed to save the WhatsApp summary." };
    }

    revalidatePath(`/contacts/${normalizedContactId}`);
    revalidatePath(`/investors/${normalizedContactId}`);

    return {
      success: true,
      summary,
      generatedAt: nowIso,
    };
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error ? err.message : "Failed to generate WhatsApp summary.";
    return { error: errMsg };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptField } from "@/lib/encryption";
import {
  retryFailedBroadcastRecipients,
  sendBroadcastBatch,
  type BroadcastSendSummary,
  type SendBroadcastResult,
} from "@/lib/broadcast-dispatch";
import { isUuid, hasInvalidId, INVALID_ID_ERROR } from "@/lib/validate";
import {
  createBroadcastHeaderUploadTarget,
  isUploadPath,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_NAME_LENGTH,
  mediaUrlForPath,
  WHATSAPP_MEDIA_BUCKET,
} from "@/lib/storage";
import { isTemplateMediaHeaderFormat, type TemplateMediaHeaderFormat } from "@/lib/whatsapp";

export type TargetType = "group" | "tag" | "manual";

export interface GroupOption {
  id: string;
  name: string;
}

export interface ContactOption {
  id: string;
  name: string;
  phone: string;
  /** The contact's section (e.g. a team member's list); absent if sections are not set up. */
  section_id?: string | null;
}

export interface TemplateOption {
  id: string;
  name: string;
  category: string | null;
  body_text: string;
  variables: Record<string, string>;
  approved_at?: string | null;
  /** Set when the template was synced from Meta and is sent as a real WhatsApp template. */
  meta_template_id?: string | null;
  /** IMAGE, VIDEO or DOCUMENT when the template's header needs a file (attached to the broadcast). */
  header_format?: string | null;
}

export interface BroadcastData {
  id: string;
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  /** "sending": a large broadcast going out in batches. */
  status: "draft" | "scheduled" | "sending" | "sent";
  created_at: string;
  scheduled_for?: string | null;
  sent_at?: string | null;
  template_id?: string | null;
  variable_mappings?: Record<string, unknown> | null;
  /** Who it reached, was skipped or failed; set once sent (see lib/broadcast-dispatch). */
  send_summary?: BroadcastSendSummary | null;
  /** The stored file sent in the template's header, as a media_url (see lib/storage). */
  media_url?: string | null;
}

export interface CreateBroadcastDraftInput {
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  template_id?: string | null;
  variable_mappings?: Record<string, unknown> | null;
  /** The uploaded header file (from prepareBroadcastHeaderUpload) for a template with a media header. */
  header_media_path?: string | null;
}

export interface UpdateBroadcastInput {
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  scheduled_for?: string;
  template_id?: string | null;
  variable_mappings?: Record<string, unknown> | null;
  /** The uploaded header file (from prepareBroadcastHeaderUpload) for a template with a media header. */
  header_media_path?: string | null;
}

export interface CreateScheduledBroadcastInput {
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  scheduled_for: string;
  template_id?: string | null;
  variable_mappings?: Record<string, unknown> | null;
  /** The uploaded header file (from prepareBroadcastHeaderUpload) for a template with a media header. */
  header_media_path?: string | null;
}

function validateTemplatePayload(data?: {
  template_id?: string | null;
  variable_mappings?: Record<string, unknown> | null;
}): {
  error: string | null;
  templateId: string | null;
  variableMappings: Record<string, unknown>;
} {
  let templateId: string | null = null;
  if (data?.template_id !== undefined && data?.template_id !== null) {
    const trimmed = String(data.template_id).trim();
    if (trimmed) {
      if (!isUuid(trimmed)) {
        return {
          error: "Invalid template ID format.",
          templateId: null,
          variableMappings: {},
        };
      }
      templateId = trimmed;
    }
  }

  let variableMappings: Record<string, unknown> = {};
  if (
    data?.variable_mappings !== undefined &&
    data?.variable_mappings !== null
  ) {
    if (
      typeof data.variable_mappings !== "object" ||
      Array.isArray(data.variable_mappings)
    ) {
      return {
        error: "Variable mappings must be an object.",
        templateId: null,
        variableMappings: {},
      };
    }
    variableMappings = data.variable_mappings;
  }

  return { error: null, templateId, variableMappings };
}

/** Files a Meta template header accepts, per header kind. */
const HEADER_FILE_TYPES: Record<TemplateMediaHeaderFormat, { types: string[]; maxBytes: number; label: string }> = {
  IMAGE: { types: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, label: "a JPG or PNG image under 5 MB" },
  VIDEO: { types: ["video/mp4", "video/3gpp"], maxBytes: MAX_UPLOAD_BYTES[WHATSAPP_MEDIA_BUCKET], label: "an MP4 video under 16 MB" },
  DOCUMENT: { types: ["application/pdf"], maxBytes: MAX_UPLOAD_BYTES[WHATSAPP_MEDIA_BUCKET], label: "a PDF under 16 MB" },
};

async function templateHeaderFormat(templateId: string): Promise<TemplateMediaHeaderFormat | null> {
  // Read through to_jsonb so this works before migration 004 adds the column.
  const row = await db
    .maybeOne<{ header_format: string | null }>(
      `select to_jsonb(t) ->> 'header_format' as header_format from templates t where id = $1`,
      [templateId],
    )
    .catch(() => null);
  return isTemplateMediaHeaderFormat(row?.header_format) ? row.header_format : null;
}

/**
 * The media_url to save on a broadcast: the uploaded header file when its
 * template's header needs one (required then), otherwise null.
 */
async function resolveHeaderMedia(
  templateId: string | null,
  headerMediaPath: string | null | undefined,
): Promise<{ error?: string; mediaUrl: string | null }> {
  const format = templateId ? await templateHeaderFormat(templateId) : null;
  if (!format) return { mediaUrl: null };
  const path = (headerMediaPath ?? "").trim();
  if (!path) {
    return { error: `This template needs ${HEADER_FILE_TYPES[format].label} in its header. Please attach it.`, mediaUrl: null };
  }
  if (!isUploadPath(path)) return { error: "The attached file is not valid. Please attach it again.", mediaUrl: null };
  return { mediaUrl: encryptField(mediaUrlForPath(path)) };
}

/**
 * Step 1 of attaching the header file of a broadcast's template: checks the
 * file and returns where the browser uploads it (the CRM's /api/uploads route).
 */
export async function prepareBroadcastHeaderUpload(
  templateId: string,
  filename: string,
  mimeType: string,
  size: number,
): Promise<{ path: string; uploadUrl: string } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };
  if (hasInvalidId(templateId)) return { error: INVALID_ID_ERROR };

  const format = await templateHeaderFormat(templateId);
  if (!format) return { error: "This template doesn't take a file." };
  const allowed = HEADER_FILE_TYPES[format];
  if (!size) return { error: "No file selected." };
  // Checked here so a long name gets a clear message instead of a failed upload later.
  if (!filename.trim()) return { error: "The file has no name. Please rename it and try again." };
  if (filename.length > MAX_UPLOAD_NAME_LENGTH) {
    return { error: `The file name is too long (over ${MAX_UPLOAD_NAME_LENGTH} characters). Please rename the file and try again.` };
  }
  if (!allowed.types.includes(mimeType) || size > allowed.maxBytes) {
    return { error: `Please choose ${allowed.label}.` };
  }

  try {
    return await createBroadcastHeaderUploadTarget(filename);
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Could not prepare the upload." };
  }
}

export async function createBroadcastDraft(data: CreateBroadcastDraftInput) {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }

  const messageText = (data?.message_text ?? "").trim();
  if (!messageText) {
    return { error: "Message text is required." };
  }

  const validTargetTypes: TargetType[] = ["group", "tag", "manual"];
  if (!validTargetTypes.includes(data?.target_type)) {
    return { error: "Target type must be 'group', 'tag', or 'manual'." };
  }

  if (!Array.isArray(data?.target_ids) || data.target_ids.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  // Filter out any empty strings or invalid entries
  const normalizedTargetIds = data.target_ids
    .map((id) => String(id).trim())
    .filter(Boolean);

  if (normalizedTargetIds.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  const { error: templateError, templateId, variableMappings } =
    validateTemplatePayload(data);
  if (templateError) {
    return { error: templateError };
  }

  const header = await resolveHeaderMedia(templateId, data.header_media_path);
  if (header.error) return { error: header.error };

  try {
    await db.execute(
      `insert into broadcasts (message_text, target_type, target_ids, status, template_id, variable_mappings, media_url)
       values ($1, $2, $3::text[], 'draft', $4, $5::jsonb, $6)`,
      [encryptField(messageText), data.target_type, normalizedTargetIds, templateId, JSON.stringify(variableMappings), header.mediaUrl],
    );
  } catch (error) {
    console.error("Failed to create broadcast draft.", error instanceof Error ? error.message : error);
    return { error: "Failed to create broadcast draft." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function createScheduledBroadcast(
  data: CreateScheduledBroadcastInput
) {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }

  const messageText = (data?.message_text ?? "").trim();
  if (!messageText) {
    return { error: "Message text is required." };
  }

  const validTargetTypes: TargetType[] = ["group", "tag", "manual"];
  if (!validTargetTypes.includes(data?.target_type)) {
    return { error: "Target type must be 'group', 'tag', or 'manual'." };
  }

  if (!Array.isArray(data?.target_ids) || data.target_ids.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  const normalizedTargetIds = data.target_ids
    .map((id) => String(id).trim())
    .filter(Boolean);

  if (normalizedTargetIds.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  if (!data?.scheduled_for) {
    return { error: "Scheduled date and time is required." };
  }

  const scheduledDate = new Date(data.scheduled_for);
  if (isNaN(scheduledDate.getTime())) {
    return { error: "Invalid scheduled date and time." };
  }

  if (scheduledDate.getTime() <= Date.now()) {
    return { error: "Scheduled time must be in the future." };
  }

  const { error: templateError, templateId, variableMappings } =
    validateTemplatePayload(data);
  if (templateError) {
    return { error: templateError };
  }

  const header = await resolveHeaderMedia(templateId, data.header_media_path);
  if (header.error) return { error: header.error };

  try {
    await db.execute(
      `insert into broadcasts (message_text, target_type, target_ids, status, scheduled_for, template_id, variable_mappings, media_url)
       values ($1, $2, $3::text[], 'scheduled', $4, $5, $6::jsonb, $7)`,
      [
        encryptField(messageText),
        data.target_type,
        normalizedTargetIds,
        scheduledDate.toISOString(),
        templateId,
        JSON.stringify(variableMappings),
        header.mediaUrl,
      ],
    );
  } catch (error) {
    console.error("Failed to create scheduled broadcast.", error instanceof Error ? error.message : error);
    return { error: "Failed to create scheduled broadcast." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function updateBroadcast(id: string, data: UpdateBroadcastInput) {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }
  if (hasInvalidId(id)) return { error: INVALID_ID_ERROR };

  if (!id) {
    return { error: "Broadcast ID is required." };
  }

  const messageText = (data?.message_text ?? "").trim();
  if (!messageText) {
    return { error: "Message text is required." };
  }

  const validTargetTypes: TargetType[] = ["group", "tag", "manual"];
  if (!validTargetTypes.includes(data?.target_type)) {
    return { error: "Target type must be 'group', 'tag', or 'manual'." };
  }

  if (!Array.isArray(data?.target_ids) || data.target_ids.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  const normalizedTargetIds = data.target_ids
    .map((item) => String(item).trim())
    .filter(Boolean);

  if (normalizedTargetIds.length === 0) {
    return { error: "Please select at least one recipient target." };
  }

  // Verify status is draft or scheduled
  let existing: { status: string; template_id: string | null } | null;
  try {
    existing = await db.maybeOne<{ status: string; template_id: string | null }>(
      "select status, template_id from broadcasts where id = $1 and deleted_at is null",
      [id],
    );
  } catch {
    existing = null;
  }

  if (!existing) {
    return { error: "Broadcast not found." };
  }

  if (existing.status === "sent") {
    return { error: "Sent broadcasts cannot be edited." };
  }

  if (existing.status !== "draft" && existing.status !== "scheduled") {
    return { error: "Only draft or scheduled broadcasts can be edited." };
  }

  const updatePayload: {
    message_text: string;
    target_type: TargetType;
    target_ids: string[];
    scheduled_for?: string;
    template_id?: string | null;
    variable_mappings?: Record<string, unknown>;
  } = {
    message_text: encryptField(messageText) ?? "",
    target_type: data.target_type,
    target_ids: normalizedTargetIds,
  };

  if (data?.template_id !== undefined) {
    if (data.template_id === null || String(data.template_id).trim() === "") {
      updatePayload.template_id = null;
      if (data.variable_mappings === undefined) {
        updatePayload.variable_mappings = {};
      }
    } else {
      const trimmed = String(data.template_id).trim();
      if (!isUuid(trimmed)) {
        return { error: "Invalid template ID format." };
      }
      updatePayload.template_id = trimmed;
    }
  }

  if (data?.variable_mappings !== undefined) {
    if (data.variable_mappings === null) {
      updatePayload.variable_mappings = {};
    } else if (
      typeof data.variable_mappings !== "object" ||
      Array.isArray(data.variable_mappings)
    ) {
      return { error: "Variable mappings must be an object." };
    } else {
      updatePayload.variable_mappings = data.variable_mappings;
    }
  }

  if (existing.status === "scheduled") {
    if (!data?.scheduled_for) {
      return { error: "Scheduled date and time is required." };
    }
    const scheduledDate = new Date(data.scheduled_for);
    if (isNaN(scheduledDate.getTime())) {
      return { error: "Invalid scheduled date and time." };
    }
    if (scheduledDate.getTime() <= Date.now()) {
      return { error: "Scheduled time must be in the future." };
    }
    updatePayload.scheduled_for = scheduledDate.toISOString();
  }

  // The header file follows the template: required for a media header, cleared otherwise.
  // Checked when the template or the file is sent, so replacing only the file
  // (same template) saves the new file too.
  let headerMediaUrl: string | null | undefined;
  if (updatePayload.template_id !== undefined || data.header_media_path !== undefined) {
    const templateId = updatePayload.template_id !== undefined ? updatePayload.template_id : existing.template_id;
    const header = await resolveHeaderMedia(templateId, data.header_media_path);
    if (header.error) return { error: header.error };
    headerMediaUrl = header.mediaUrl;
  }

  // Only the fields present in the payload are changed.
  const params: unknown[] = [id];
  const sets: string[] = [];
  const setField = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  setField("message_text", updatePayload.message_text);
  setField("target_type", updatePayload.target_type);
  setField("target_ids", updatePayload.target_ids, "::text[]");
  if (updatePayload.scheduled_for !== undefined) setField("scheduled_for", updatePayload.scheduled_for);
  if (updatePayload.template_id !== undefined) setField("template_id", updatePayload.template_id);
  if (updatePayload.variable_mappings !== undefined) {
    setField("variable_mappings", JSON.stringify(updatePayload.variable_mappings), "::jsonb");
  }
  if (headerMediaUrl !== undefined) setField("media_url", headerMediaUrl);

  try {
    await db.execute(`update broadcasts set ${sets.join(", ")} where id = $1`, params);
  } catch (error) {
    console.error("Failed to update broadcast.", error instanceof Error ? error.message : error);
    return { error: "Failed to update broadcast." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function deleteBroadcast(id: string) {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }
  if (hasInvalidId(id)) return { error: INVALID_ID_ERROR };

  if (!id) {
    return { error: "Broadcast ID is required." };
  }

  const current = await db
    .maybeOne<{ status: string }>("select status from broadcasts where id = $1", [id])
    .catch(() => null);
  if (current?.status === "sending") {
    return { error: "This broadcast is still sending. Wait until it finishes before deleting it." };
  }

  try {
    await db.execute(
      "update broadcasts set deleted_at = $2 where id = $1 and status <> 'sending'",
      [id, new Date().toISOString()],
    );
  } catch (error) {
    console.error("Failed to delete broadcast.", error instanceof Error ? error.message : error);
    return { error: "Failed to delete broadcast." };
  }

  revalidatePath("/broadcasts");
  return { success: true };
}

export async function deleteBroadcasts(ids: string[]) {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }
  if (hasInvalidId(ids)) return { error: INVALID_ID_ERROR };

  const broadcastIds = [...new Set(ids.filter(Boolean))];
  if (!broadcastIds.length) {
    return { error: "No broadcasts were selected." };
  }

  let deleted: number;
  try {
    deleted = await db.execute(
      "update broadcasts set deleted_at = $2 where id = any($1::uuid[]) and status <> 'sending'",
      [broadcastIds, new Date().toISOString()],
    );
  } catch (error) {
    console.error("Failed to delete broadcasts.", error instanceof Error ? error.message : error);
    return { error: "Failed to delete broadcasts." };
  }

  if (deleted === 0) {
    return { error: "Broadcasts that are still sending can't be deleted. Try again once they finish." };
  }

  revalidatePath("/broadcasts");
  return { success: true, deleted };
}

/**
 * Sends again to the recipients of a sent broadcast whose send failed. Like
 * sendBroadcastNow, call it again while the result says `done: false`.
 */
export async function retryFailedBroadcast(broadcastId: string): Promise<SendBroadcastResult> {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }
  if (hasInvalidId(broadcastId)) return { error: INVALID_ID_ERROR };

  const result = await retryFailedBroadcastRecipients(broadcastId);
  revalidatePath("/broadcasts");
  revalidatePath(`/broadcasts/${broadcastId}`);
  return result;
}

/**
 * Starts a draft broadcast and sends as much as fits in one request (large
 * broadcasts go out in batches). While the result says `done: false`, call it
 * again to continue; if the page is closed, the 5-minute scheduler finishes it.
 */
export async function sendBroadcastNow(
  broadcastId: string
): Promise<SendBroadcastResult> {
  const { error: authError } = await requireActionAuth();
  if (authError) {
    return { error: "Unauthorized" };
  }
  if (hasInvalidId(broadcastId)) return { error: INVALID_ID_ERROR };

  return sendBroadcastBatch(broadcastId);
}

import { NextResponse } from "next/server";
import { sendButtonAutoReply } from "@/lib/auto-reply";
import crypto from "crypto";
import { db, isUniqueViolation } from "@/lib/db";
import { safeEqual } from "@/lib/secure-compare";
import { storeInboundWhatsAppMedia } from "@/lib/inbound-media";
import { applyDeliveryStatus, describeDeliveryError } from "@/lib/message-status";
import { normalizeToLocalPhone } from "@/lib/whatsapp";

// In-memory bounded cache for recently processed Meta message IDs (wamid)
const MAX_CACHE_SIZE = 5000;
const processedMessageIds = new Set<string>();

/** A message could not be saved; the webhook answers 500 so Meta sends it again. */
class RetryableWebhookError extends Error {}

function markAndCheckDuplicateId(id: string | undefined): boolean {
  if (!id) return false;
  if (processedMessageIds.has(id)) {
    return true;
  }
  if (processedMessageIds.size >= MAX_CACHE_SIZE) {
    const oldestKey = processedMessageIds.values().next().value;
    if (oldestKey) {
      processedMessageIds.delete(oldestKey);
    }
  }
  processedMessageIds.add(id);
  return false;
}

// In-memory bounded cache for recently processed Meta status updates (wamid:status)
const processedStatusKeys = new Set<string>();

function markAndCheckDuplicateStatus(
  id: string | undefined,
  status: string | undefined
): boolean {
  if (!id || !status) return false;
  const key = `${id}:${status}`;
  if (processedStatusKeys.has(key)) {
    return true;
  }
  if (processedStatusKeys.size >= MAX_CACHE_SIZE) {
    const oldestKey = processedStatusKeys.values().next().value;
    if (oldestKey) {
      processedStatusKeys.delete(oldestKey);
    }
  }
  processedStatusKeys.add(key);
  return false;
}

export interface MetaStatusError {
  code: number;
  title?: string;
  message?: string;
  error_data?: {
    details?: string;
  };
}

export interface MetaStatusUpdate {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string | number;
  recipient_id?: string;
  conversation?: {
    id?: string;
    origin?: {
      type?: string;
    };
  };
  pricing?: {
    billable?: boolean;
    pricing_model?: string;
    category?: string;
  };
  errors?: MetaStatusError[];
  [key: string]: unknown;
}

interface MetaMediaData {
  id?: string;
  link?: string;
  url?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
  sha256?: string;
}

interface MetaMessageBase {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string | number;
  type?: string;
  is_echo?: boolean;
  text?: { body?: string };
  interactive?: {
    button_reply?: { title?: string; id?: string };
    list_reply?: { title?: string; id?: string };
  };
  button?: { text?: string; payload?: string };
  image?: MetaMediaData;
  video?: MetaMediaData;
  document?: MetaMediaData;
  audio?: MetaMediaData;
  voice?: MetaMediaData;
  sticker?: MetaMediaData;
  [key: string]: unknown;
}

interface MetaChangeValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    profile?: { name?: string };
    wa_id?: string;
  }>;
  messages?: MetaMessageBase[];
  message_echoes?: MetaMessageBase[];
  statuses?: MetaStatusUpdate[];
}

interface MetaChange {
  field?: string;
  value?: MetaChangeValue;
}

interface MetaEntry {
  id?: string;
  changes?: MetaChange[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaEntry[];
}

/**
 * Meta Webhook verification endpoint (GET).
 * Meta sends hub.mode, hub.verify_token, and hub.challenge.
 * Must return hub.challenge with 200 OK when verification succeeds.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Meta Webhook event handler (POST).
 * Synchronizes incoming WhatsApp messages and outgoing coexistence echoes into whatsapp_messages.
 */
export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 },
    );
  }

  // Verify the HMAC-SHA256 signature. Fails closed in production if the app
  // secret is missing; local dev without a secret stays usable.
  const appSecret =
    process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 401 },
      );
    }
    const expectedSignature = `sha256=${crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex")}`;
    if (!safeEqual(signature, expectedSignature)) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[WhatsApp Webhook] META_APP_SECRET is not set; rejecting request.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 401 });
  }

  let body: MetaWebhookPayload;
  try {
    body = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  // Gracefully ignore non-WhatsApp events
  if (body?.object !== "whatsapp_business_account") {
    return NextResponse.json(
      { status: "ignored", reason: "Not a whatsapp_business_account event" },
      { status: 200 },
    );
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  let processedCount = 0;
  let needsRetry = false;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== "object") continue;

      // Extract business phone number from metadata if available
      const businessPhone =
        value.metadata?.display_phone_number?.replace(/\D/g, "") || "";

      // 1. Process Incoming Messages
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        try {
          const isEcho =
            msg.is_echo === true ||
            Boolean(
              businessPhone &&
                msg.from &&
                msg.from.replace(/\D/g, "") === businessPhone,
            );

          const direction = isEcho ? ("out" as const) : ("in" as const);
          const targetPhone = isEcho ? msg.to : msg.from;

          // The sender's WhatsApp profile name, used to pre-fill "Save contact".
          const profileName = isEcho
            ? undefined
            : value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ??
              value.contacts?.[0]?.profile?.name;

          await processSingleMessage({
            messageId: msg.id,
            phone: targetPhone,
            timestamp: msg.timestamp,
            type: msg.type,
            msgData: msg,
            direction,
            profileName,
          });

          processedCount++;
        } catch (err) {
          // Error isolation: single failure does not crash the entire webhook batch
          console.error("[WhatsApp Webhook] Error processing message:", err);
          if (err instanceof RetryableWebhookError) needsRetry = true;
        }
      }

      // 2. Process Outgoing Coexistence Echoes (smb_message_echoes / value.message_echoes)
      const echoes = Array.isArray(value.message_echoes)
        ? value.message_echoes
        : [];
      for (const echo of echoes) {
        try {
          await processSingleMessage({
            messageId: echo.id,
            phone: echo.to,
            timestamp: echo.timestamp,
            type: echo.type,
            msgData: echo,
            direction: "out",
          });

          processedCount++;
        } catch (err) {
          // Error isolation
          console.error("[WhatsApp Webhook] Error processing echo:", err);
          if (err instanceof RetryableWebhookError) needsRetry = true;
        }
      }

      // 3. Process Outbound Message Delivery Statuses (value.statuses)
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const statusObj of statuses) {
        try {
          await processStatusUpdate(statusObj as MetaStatusUpdate);
          processedCount++;
        } catch (err) {
          // Error isolation: single status failure does not crash the webhook batch
          console.error(
            "[WhatsApp Webhook] Error processing status update:",
            err
          );
        }
      }
    }
  }

  // A message that could not be saved is sent again by Meta. That is safe:
  // messages are matched by their WhatsApp message ID, so nothing is saved twice.
  if (needsRetry) {
    return NextResponse.json(
      { success: false, error: "A message could not be saved; please retry." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    processed: processedCount,
  });
}

async function processStatusUpdate(statusUpdate: MetaStatusUpdate) {
  const { id: messageId, status, recipient_id, errors } = statusUpdate;

  if (!messageId || !status) {
    return { success: false, reason: "Missing messageId or status" };
  }

  // Idempotency: avoid processing identical (messageId, status) events more than once
  if (markAndCheckDuplicateStatus(messageId, status)) {
    return { success: true, duplicate: true };
  }

  const firstError =
    Array.isArray(errors) && errors.length > 0 ? errors[0] : null;
  const errorInfo = firstError
    ? ` code=${firstError.code} title="${firstError.title || firstError.message || ""}"`
    : "";

  console.log(
    `[WhatsApp Webhook] Delivery status update: wamid=${messageId} status=${status}${errorInfo}`
  );

  // Save it on the message so the chat can show ticks and, for a failure, why.
  const reportedAt = statusUpdate.timestamp
    ? new Date(Number(statusUpdate.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  const errorText = firstError
    ? describeDeliveryError(
        firstError.code,
        firstError.title || firstError.message,
        firstError.error_data?.details,
      )
    : null;
  await applyDeliveryStatus(messageId, status, errorText, reportedAt);
  return {
    success: true,
    messageId,
    status,
    recipientId: recipient_id,
    errorCode: firstError?.code,
  };
}

interface ProcessMessageArgs {
  messageId?: string;
  phone?: string;
  timestamp?: string | number;
  type?: string;
  msgData: MetaMessageBase;
  direction: "in" | "out";
  profileName?: string;
}

async function processSingleMessage({
  messageId,
  phone,
  timestamp,
  type,
  msgData,
  direction,
  profileName,
}: ProcessMessageArgs) {
  // Application-level deduplication: check in-memory cache of recent wamid
  if (messageId && markAndCheckDuplicateId(messageId)) {
    return;
  }

  // The webhook has no signed-in user; it talks to the database directly.

  // Extract message content & media info safely without assuming text
  let messageText: string | null = null;
  let mediaUrl: string | null = null;

  if (type === "text") {
    messageText = msgData.text?.body ?? null;
  } else if (type === "interactive") {
    messageText =
      msgData.interactive?.button_reply?.title ||
      msgData.interactive?.list_reply?.title ||
      null;
  } else if (type === "button") {
    messageText = msgData.button?.text ?? null;
  } else if (
    type === "image" ||
    type === "video" ||
    type === "document" ||
    type === "audio" ||
    type === "voice" ||
    type === "sticker"
  ) {
    const mediaObj = msgData[type] as MetaMediaData | undefined;

    messageText = mediaObj?.caption ?? null;
    // Meta's own `url` only works with our access token, so it can't be shown
    // in the browser. Download the file by its media ID and keep our own
    // copy; if that fails, keep the ID so it can be fetched when opened.
    mediaUrl = mediaObj?.link || null;
    if (!mediaUrl && mediaObj?.id) {
      try {
        mediaUrl = await storeInboundWhatsAppMedia(mediaObj.id, mediaObj.filename);
      } catch (err) {
        console.error("[WhatsApp Webhook] Could not store incoming media:", err);
        mediaUrl = `meta_media_id:${mediaObj.id}`;
      }
    }
  }

  // Parse timestamp
  let sentAt: string;
  if (timestamp) {
    const parsedSec =
      typeof timestamp === "number"
        ? timestamp
        : parseInt(String(timestamp), 10);
    if (!isNaN(parsedSec) && parsedSec > 0) {
      sentAt = new Date(parsedSec * 1000).toISOString();
    } else {
      sentAt = new Date().toISOString();
    }
  } else {
    sentAt = new Date().toISOString();
  }

  // Match contact by phone
  let contactId: string | null = null;

  if (phone) {
    const localPhone = normalizeToLocalPhone(String(phone));
    const rawDigits = String(phone).replace(/\D/g, "");

    const candidates = Array.from(
      new Set([localPhone, rawDigits].filter(Boolean) as string[]),
    );

    if (candidates.length > 0) {
      try {
        const contact = await db.maybeOne<{ id: string }>(
          "select id from contacts where deleted_at is null and phone = any($1::text[]) limit 1",
          [candidates],
        );
        if (contact) contactId = contact.id;
      } catch {
        // A failed lookup leaves the message unlinked, as before.
      }
    }
  }

  // Database-level deduplication. WhatsApp gives every message a unique ID, so
  // that is the check. Only a message without an ID falls back to comparing content.
  try {
    if (messageId) {
      const sameId = await db.maybeOne<{ id: string }>(
        "select id from whatsapp_messages where wamid = $1 limit 1",
        [messageId],
      );
      if (sameId) return; // already saved
    } else {
      const existing = await db.maybeOne<{ id: string }>(
        `select id from whatsapp_messages
          where direction = $1 and sent_at = $2::timestamptz and deleted_at is null
            and contact_id is not distinct from $3::uuid
            and message_text is not distinct from $4::text
            and media_url is not distinct from $5::text
          limit 1`,
        [direction, sentAt, contactId, messageText, mediaUrl],
      );
      if (existing) return; // already saved
    }
  } catch {
    // A failed duplicate check falls through to the insert, as before.
  }

  // Insert into whatsapp_messages. The number is kept so a message from an
  // unknown number can be linked once that number is saved as a contact.
  const row = {
    contact_id: contactId,
    direction,
    message_text: messageText,
    media_url: mediaUrl,
    sent_at: sentAt,
    deleted_at: null,
    phone: phone ? normalizeToLocalPhone(String(phone)) : null,
    profile_name: profileName?.trim() || null,
    wamid: messageId ?? null,
  };
  let insertError: unknown = null;
  // Column names come from the fixed row object above, never from user input.
  const columns = Object.keys(row) as Array<keyof typeof row>;
  try {
    await db.execute(
      `insert into whatsapp_messages (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      columns.map((column) => row[column]),
    );
  } catch (err) {
    insertError = err;
  }

  // A second copy of the same message lost the race to the first: nothing to do.
  if (isUniqueViolation(insertError)) return;

  if (insertError) {
    const insertMessage = (insertError as Error).message;
    console.error(
      "[WhatsApp Webhook] Failed to insert message row:",
      insertMessage,
    );
    // Forget the ID so Meta's retry is processed rather than treated as a repeat.
    if (messageId) processedMessageIds.delete(messageId);
    throw new RetryableWebhookError(insertMessage);
  }

  // Template quick-reply buttons (e.g. "Send details first") get a file back.
  if (direction === "in" && type === "button") {
    const repliedToId = (msgData.context as { id?: string } | undefined)?.id;
    await sendButtonAutoReply({ buttonTitle: messageText, repliedToId, phone, contactId });
  }
}

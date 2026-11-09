import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  normalizePhoneForWhatsApp,
  sendWhatsAppMessage,
  sendWhatsAppTemplateMessage,
} from "@/lib/whatsapp";
import { insertOutboundMessage } from "@/lib/message-status";
import {
  extractPlaceholders,
  fillPlaceholders,
  SUPPORTED_CONTACT_FIELDS,
  type SupportedContactField,
  type VariableMappings,
} from "@/lib/template-placeholders";

/** Stored on broadcasts.send_summary once a broadcast has been sent. */
export interface BroadcastSendSummary {
  total: number;
  sent: number;
  /** Plain text not sent because the contact's 24-hour reply window was closed. */
  skipped: number;
  failed: number;
  skipped_names: string[];
  failures: Array<{ name: string; error: string }>;
}

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Contacts (of the given ids) who messaged in the last 24 hours. Meta only
 * delivers free-form text to them; to anyone else it is silently dropped.
 * Returns null if the lookup fails, so sending isn't blocked by a CRM error.
 */
async function contactsWithOpenReplyWindow(contactIds: string[]): Promise<Set<string> | null> {
  const since = new Date(Date.now() - REPLY_WINDOW_MS).toISOString();
  try {
    const rows = await db.query<{ contact_id: string }>(
      `select distinct contact_id
         from whatsapp_messages
        where contact_id = any($1::uuid[])
          and direction = 'in'
          and deleted_at is null
          and sent_at >= $2`,
      [contactIds, since],
    );
    return new Set(rows.map((row) => row.contact_id));
  } catch {
    return null;
  }
}

const ALLOWED_CONTACT_FIELDS = new Set<SupportedContactField>(SUPPORTED_CONTACT_FIELDS);

function validateTemplateMappingsForSend(
  templateBody: string,
  rawMappings: unknown
): { error: string | null; mappings: VariableMappings } {
  const placeholders = extractPlaceholders(templateBody);
  if (placeholders.length === 0) {
    return { error: null, mappings: {} };
  }

  if (
    !rawMappings ||
    typeof rawMappings !== "object" ||
    Array.isArray(rawMappings)
  ) {
    return {
      error: "Broadcast is missing variable mappings for template placeholders.",
      mappings: {},
    };
  }

  const mapObj = rawMappings as Record<string, unknown>;
  const validated: VariableMappings = {};

  for (const ph of placeholders) {
    const entry = mapObj[ph];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        error: `Template placeholder {{${ph}}} has no configured mapping.`,
        mappings: {},
      };
    }

    const rawEntry = entry as Record<string, unknown>;
    const type = rawEntry.type;

    if (type === "static") {
      if (typeof rawEntry.value !== "string" || !rawEntry.value.trim()) {
        return {
          error: `Static mapping for {{${ph}}} must have a non-empty value.`,
          mappings: {},
        };
      }
      validated[ph] = {
        type: "static",
        value: rawEntry.value,
      };
    } else if (type === "contact_field") {
      const field = rawEntry.field as SupportedContactField;
      if (!ALLOWED_CONTACT_FIELDS.has(field)) {
        return {
          error: `Invalid contact field "${String(rawEntry.field)}" for placeholder {{${ph}}}.`,
          mappings: {},
        };
      }
      validated[ph] = {
        type: "contact_field",
        field,
        fallback:
          typeof rawEntry.fallback === "string" && rawEntry.fallback.trim()
            ? rawEntry.fallback.trim()
            : undefined,
      };
    } else {
      return {
        error: `Invalid mapping type for placeholder {{${ph}}}.`,
        mappings: {},
      };
    }
  }

  return { error: null, mappings: validated };
}

function resolveContactField(
  contact: { name?: string | null; phone?: string | null; email?: string | null },
  field: SupportedContactField
): string | null {
  if (field === "first_name") {
    const name = (contact.name ?? "").trim();
    if (!name) return null;
    const tokens = name.split(/\s+/);
    return tokens[0] || null;
  }
  if (field === "name") {
    const name = (contact.name ?? "").trim();
    return name || null;
  }
  if (field === "phone") {
    const phone = (contact.phone ?? "").trim();
    return phone || null;
  }
  if (field === "email") {
    const email = (contact.email ?? "").trim();
    return email || null;
  }
  return null;
}

function resolveBroadcastMessageForContact({
  templateBody,
  mappings,
  contact,
}: {
  templateBody: string;
  mappings: VariableMappings;
  contact: { name: string; phone: string; email?: string | null };
}): { message: string | null; params: string[]; error: string | null } {
  const placeholders = extractPlaceholders(templateBody);
  // Values in placeholder order, for sending a Meta template.
  const params: string[] = [];
  const values: Record<string, string> = {};

  for (const ph of placeholders) {
    const mapping = mappings[ph];
    if (!mapping) {
      return {
        message: null,
        params: [],
        error: `Missing mapping for placeholder {{${ph}}}`,
      };
    }

    if (mapping.type === "static") {
      values[ph] = mapping.value;
      params.push(mapping.value);
    } else if (mapping.type === "contact_field") {
      const fieldVal = resolveContactField(contact, mapping.field);
      let finalVal: string | null = fieldVal;

      if (!finalVal) {
        if (mapping.fallback) {
          finalVal = mapping.fallback;
        } else {
          return {
            message: null,
            params: [],
            error: `Contact is missing "${mapping.field}" with no fallback provided for {{${ph}}}`,
          };
        }
      }

      values[ph] = finalVal;
      params.push(finalVal);
    }
  }

  return { message: fillPlaceholders(templateBody, (ph) => values[ph]), params, error: null };
}


/** How far a broadcast has got. `done` once every recipient has an outcome. */
export interface BroadcastProgress {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Recipients still waiting to be sent. */
  remaining: number;
  done: boolean;
}

export type SendBroadcastResult =
  | ({ success: true; error?: undefined } & BroadcastProgress)
  | { success?: false; error: string };

// Keep each request short so the scheduler call and proxies don't time out. Recipients are claimed in small batches
// and sent a few at a time, stopping with a safety margin before the limit.
const BATCH_SIZE = 20;
const CONCURRENCY = 5;
const DEADLINE_MARGIN_MS = 6_000;
/** A recipient claimed this long ago without an outcome was interrupted. */
const STALE_SENDING_MS = 10 * 60 * 1000;
/** Time budget for one "Send Now" / "continue" request from the browser. */
export const SEND_NOW_BUDGET_MS = 40_000;
/** Time budget for one scheduler run (the scheduled function waits up to 30 s). */
const SCHEDULER_BUDGET_MS = 22_000;

type TargetContact = { id: string; name: string; phone: string; email?: string | null };

type RecipientRow = {
  id: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
};

interface PreparedBroadcast {
  id: string;
  messageText: string;
  targetType: string;
  targetIds: string[];
  templateBody: string | null;
  mappings: VariableMappings;
  /** Set for templates synced from Meta: sent as a real WhatsApp template. */
  metaTemplate: { name: string; language: string } | null;
}

/** Loads a broadcast and checks its template and variable mappings. */
async function prepareBroadcast(
  broadcastId: string
): Promise<{ prepared?: PreparedBroadcast; error?: string }> {
  let broadcast: {
    id: string;
    message_text: string;
    target_type: string;
    target_ids: string[] | null;
    template_id: string | null;
    variable_mappings: unknown;
  } | null;
  try {
    broadcast = await db.maybeOne(
      `select id, message_text, target_type, target_ids, template_id, variable_mappings
         from broadcasts
        where id = $1 and deleted_at is null`,
      [broadcastId],
    );
  } catch {
    broadcast = null;
  }

  if (!broadcast) {
    return { error: "Broadcast not found." };
  }

  let templateBody: string | null = null;
  let mappings: VariableMappings = {};
  let metaTemplate: PreparedBroadcast["metaTemplate"] = null;

  if (broadcast.template_id) {
    let tmpl: {
      id: string;
      name: string;
      language: string;
      body_text: string | null;
      meta_template_id: string | null;
      approved_at: string | null;
    } | null;
    try {
      tmpl = await db.maybeOne(
        `select id, name, language, body_text, meta_template_id, approved_at
           from templates
          where id = $1 and deleted_at is null`,
        [broadcast.template_id],
      );
    } catch {
      tmpl = null;
    }

    if (!tmpl || !tmpl.body_text) {
      return { error: "Referenced template not found or is inactive." };
    }

    if (tmpl.meta_template_id) {
      if (!tmpl.approved_at) {
        return {
          error: `Template "${tmpl.name}" is not approved by Meta yet. Sync templates again once it is approved.`,
        };
      }
      metaTemplate = { name: tmpl.name, language: tmpl.language };
    }

    const validation = validateTemplateMappingsForSend(tmpl.body_text, broadcast.variable_mappings);
    if (validation.error) {
      return { error: validation.error };
    }

    templateBody = tmpl.body_text;
    mappings = validation.mappings;
  }

  return {
    prepared: {
      id: broadcast.id,
      messageText: broadcast.message_text,
      targetType: broadcast.target_type,
      targetIds: broadcast.target_ids ?? [],
      templateBody,
      mappings,
      metaTemplate,
    },
  };
}

/** The contacts a broadcast targets (group members, tagged or hand-picked). */
async function resolveTargetContacts(prepared: PreparedBroadcast): Promise<TargetContact[]> {
  if (prepared.targetType === "manual") {
    return db.query<TargetContact>(
      `select id, name, phone, email
         from contacts
        where id = any($1::uuid[]) and deleted_at is null`,
      [prepared.targetIds],
    );
  }

  if (prepared.targetType === "group") {
    // A contact in several of the groups is listed once.
    return db.query<TargetContact>(
      `select distinct on (c.id) c.id, c.name, c.phone, c.email
         from contact_groups cg
         join contacts c on c.id = cg.contact_id
        where cg.group_id = any($1::uuid[]) and c.deleted_at is null
        order by c.id`,
      [prepared.targetIds],
    );
  }

  if (prepared.targetType === "tag") {
    return db.query<TargetContact>(
      `select id, name, phone, email
         from contacts
        where tags && $1::text[] and deleted_at is null`,
      [prepared.targetIds],
    );
  }

  return [];
}

/** Recipients couldn't be recorded while starting a broadcast. */
class PrepareRecipientsError extends Error {}

/**
 * Starts sending a broadcast: checks it, moves it from `fromStatus` to
 * "sending" (one conditional update, so it can only start once) and records
 * every recipient as pending. Messages are then sent by processBroadcast.
 */
export async function startBroadcast(
  broadcastId: string,
  fromStatus: "draft" | "scheduled"
): Promise<{ error?: string }> {
  const { prepared, error } = await prepareBroadcast(broadcastId);
  if (!prepared) return { error: error ?? "Broadcast not found." };

  let contacts: TargetContact[];
  try {
    contacts = await resolveTargetContacts(prepared);
  } catch {
    return { error: "Failed to resolve recipient contacts." };
  }
  if (contacts.length === 0) {
    return { error: "No active recipient contacts found for this target." };
  }

  // The status change and the recipients are saved together: if the recipients
  // can't be recorded nothing has been sent, and the broadcast stays as it was.
  let alreadyStarted = false;
  try {
    await db.tx(async (tx) => {
      const claimed = await tx.query<{ id: string }>(
        `update broadcasts set status = 'sending'
          where id = $1 and status = $2
          returning id`,
        [broadcastId, fromStatus],
      );
      if (claimed.length === 0) {
        alreadyStarted = true;
        return;
      }

      for (let i = 0; i < contacts.length; i += 500) {
        const rows = contacts.slice(i, i + 500).map((c) => ({
          contact_id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email ?? null,
        }));
        try {
          await tx.execute(
            `insert into broadcast_recipients (broadcast_id, contact_id, name, phone, email)
             select $1::uuid, x.contact_id, x.name, x.phone, x.email
               from jsonb_to_recordset($2::jsonb)
                    as x(contact_id uuid, name text, phone text, email text)
             on conflict (broadcast_id, contact_id) do nothing`,
            [broadcastId, JSON.stringify(rows)],
          );
        } catch (err: unknown) {
          throw new PrepareRecipientsError(err instanceof Error ? err.message : "");
        }
      }
    });
  } catch (err: unknown) {
    if (err instanceof PrepareRecipientsError) {
      return { error: `Could not prepare the recipients: ${err.message}` };
    }
    return { error: (err instanceof Error && err.message) || "Could not start the broadcast." };
  }
  if (alreadyStarted) {
    return { error: "This broadcast is already being sent or has been sent." };
  }

  revalidatePath("/broadcasts");
  return {};
}

/** Sends to one recipient and records the outcome on its row. */
async function sendToRecipient(
  prepared: PreparedBroadcast,
  recipient: RecipientRow,
  openWindowIds: Set<string> | null
): Promise<void> {
  const finish = async (
    status: "sent" | "skipped" | "failed",
    error: string | null = null,
    wamid?: string
  ) => {
    const sentAt = status === "sent" ? new Date().toISOString() : null;
    try {
      // wamid is only set when WhatsApp returned a message ID; otherwise it is left as it was.
      await db.execute(
        `update broadcast_recipients
            set status = $2, error = $3, sent_at = $4, wamid = coalesce($5, wamid)
          where id = $1`,
        [recipient.id, status, error, sentAt, wamid ?? null],
      );
    } catch (err: unknown) {
      console.error("[broadcast] Could not record the outcome for a recipient:", err);
    }
  };

  // Plain text only reaches contacts inside their 24-hour reply window.
  if (openWindowIds && !(recipient.contact_id && openWindowIds.has(recipient.contact_id))) {
    await finish(
      "skipped",
      "Not sent: no message from this contact in the last 24 hours. Use an approved Meta template."
    );
    return;
  }

  const normalizedPhone = normalizePhoneForWhatsApp(recipient.phone ?? "");
  if (!normalizedPhone) {
    await finish("failed", "Invalid phone number format");
    return;
  }

  let messageToSend = prepared.messageText;
  let templateParams: string[] = [];
  if (prepared.templateBody) {
    const resolution = resolveBroadcastMessageForContact({
      templateBody: prepared.templateBody,
      mappings: prepared.mappings,
      contact: {
        name: recipient.name ?? "",
        phone: recipient.phone ?? "",
        email: recipient.email,
      },
    });
    if (resolution.error || !resolution.message) {
      await finish("failed", resolution.error || "Failed to resolve template variables");
      return;
    }
    messageToSend = resolution.message;
    templateParams = resolution.params;
  }

  let wamid: string | undefined;
  try {
    const response = prepared.metaTemplate
      ? await sendWhatsAppTemplateMessage({
          to: normalizedPhone,
          templateName: prepared.metaTemplate.name,
          language: prepared.metaTemplate.language,
          bodyParameters: templateParams,
        })
      : await sendWhatsAppMessage({ to: normalizedPhone, message: messageToSend });
    wamid = response.messages?.[0]?.id;
  } catch (err: unknown) {
    await finish("failed", err instanceof Error ? err.message : "Failed to send message");
    return;
  }

  await finish("sent", null, wamid);

  // Log it so it shows in WhatsApp History. The message already went out, so
  // a logging failure doesn't count against the recipient.
  if (recipient.contact_id) {
    const { error: logError } = await insertOutboundMessage(
      { contact_id: recipient.contact_id, message_text: messageToSend },
      wamid,
    );
    if (logError) {
      console.error("Failed to log outbound broadcast message:", logError);
    }
  }
}

/** Current counts; marks the broadcast sent (with its summary) once all are done. */
async function finalizeIfDone(broadcastId: string): Promise<BroadcastProgress> {
  const countRows = await db.query<{ status: string; n: number }>(
    `select status, count(*)::int as n
       from broadcast_recipients
      where broadcast_id = $1
      group by status`,
    [broadcastId],
  );
  const countOf = (status: string) => countRows.find((r) => r.status === status)?.n ?? 0;
  const pending = countOf("pending");
  const sending = countOf("sending");
  const sent = countOf("sent");
  const skipped = countOf("skipped");
  const failed = countOf("failed");
  const remaining = pending + sending;
  const progress: BroadcastProgress = {
    total: remaining + sent + skipped + failed,
    sent,
    skipped,
    failed,
    remaining,
    done: remaining === 0,
  };
  if (!progress.done) return progress;

  const [skippedRows, failedRows] = await Promise.all([
    db.query<{ name: string | null }>(
      `select name from broadcast_recipients
        where broadcast_id = $1 and status = 'skipped'
        order by name
        limit 100`,
      [broadcastId],
    ),
    db.query<{ name: string | null; error: string | null }>(
      `select name, error from broadcast_recipients
        where broadcast_id = $1 and status = 'failed'
        order by name
        limit 100`,
      [broadcastId],
    ),
  ]);

  const summary: BroadcastSendSummary = {
    total: progress.total,
    sent,
    skipped,
    failed,
    skipped_names: skippedRows.map((r) => r.name ?? "Unknown"),
    failures: failedRows.map((r) => ({
      name: r.name ?? "Unknown",
      error: r.error ?? "Unknown error",
    })),
  };

  await db.execute(
    `update broadcasts
        set status = 'sent', sent_at = $2, send_summary = $3::jsonb
      where id = $1 and status = 'sending'`,
    [broadcastId, new Date().toISOString(), JSON.stringify(summary)],
  );

  revalidatePath("/broadcasts");
  revalidatePath(`/broadcasts/${broadcastId}`);
  return progress;
}

/**
 * Sends the next batches of a broadcast that is "sending", until every
 * recipient is done or the time budget runs out. Safe to call from several
 * places at once: each recipient is claimed by exactly one caller.
 */
export async function processBroadcast(
  broadcastId: string,
  budgetMs: number
): Promise<BroadcastProgress> {
  const deadline = Date.now() + budgetMs - DEADLINE_MARGIN_MS;

  // A recipient left "sending" by a run that was cut off may or may not have
  // received the message; never resend, record it as failed instead.
  await db.execute(
    `update broadcast_recipients
        set status = 'failed',
            error = 'Interrupted while sending; it may or may not have been delivered.'
      where broadcast_id = $1 and status = 'sending' and claimed_at < $2`,
    [broadcastId, new Date(Date.now() - STALE_SENDING_MS).toISOString()],
  );

  const { prepared, error } = await prepareBroadcast(broadcastId);
  if (!prepared) {
    // E.g. its template was deleted mid-send: the rest can't be sent.
    await db.execute(
      `update broadcast_recipients
          set status = 'failed', error = $2
        where broadcast_id = $1 and status = 'pending'`,
      [broadcastId, error ?? "Broadcast could not be sent."],
    );
    return finalizeIfDone(broadcastId);
  }

  while (Date.now() < deadline) {
    let recipients: RecipientRow[];
    try {
      recipients = await db.query<RecipientRow>(
        "select * from public.claim_broadcast_recipients($1::uuid, $2::int)",
        [broadcastId, BATCH_SIZE],
      );
    } catch (claimError: unknown) {
      console.error(
        "[broadcast] Could not claim recipients:",
        claimError instanceof Error ? claimError.message : claimError,
      );
      break;
    }
    if (recipients.length === 0) break;

    const openWindowIds = prepared.metaTemplate
      ? null
      : await contactsWithOpenReplyWindow(
          recipients.map((r) => r.contact_id).filter((id): id is string => Boolean(id))
        );

    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      await Promise.all(
        recipients
          .slice(i, i + CONCURRENCY)
          .map((r) => sendToRecipient(prepared, r, openWindowIds))
      );
    }
  }

  return finalizeIfDone(broadcastId);
}

/** Starts a draft broadcast (if not already started) and sends as much as fits in one request. */
export async function sendBroadcastBatch(broadcastId: string): Promise<SendBroadcastResult> {
  if (!broadcastId) return { error: "Broadcast ID is required." };

  try {
    const broadcast = await db.maybeOne<{ status: string }>(
      "select status from broadcasts where id = $1 and deleted_at is null",
      [broadcastId],
    );
    if (!broadcast) return { error: "Broadcast not found." };
    if (broadcast.status === "sent") return { error: "This broadcast has already been sent." };
    if (broadcast.status === "scheduled") {
      return { error: "This broadcast is scheduled. Edit it to send it now instead." };
    }

    if (broadcast.status === "draft") {
      const started = await startBroadcast(broadcastId, "draft");
      if (started.error) return { error: started.error };
    }

    const progress = await processBroadcast(broadcastId, SEND_NOW_BUDGET_MS);
    return { success: true, ...progress };
  } catch (err: unknown) {
    console.error("[broadcast] Send failed:", err);
    return { error: "Could not send the broadcast." };
  }
}

/**
 * Sends again to recipients of a finished broadcast whose send failed. Only
 * failures where WhatsApp refused the message are retried; recipients with an
 * invalid number, or whose send was interrupted (it may already have been
 * delivered), are left alone so nobody gets the message twice.
 */
export async function retryFailedBroadcastRecipients(
  broadcastId: string
): Promise<SendBroadcastResult> {
  if (!broadcastId) return { error: "Broadcast ID is required." };

  try {
    const broadcast = await db.maybeOne<{ status: string }>(
      "select status from broadcasts where id = $1 and deleted_at is null",
      [broadcastId],
    );
    if (!broadcast) return { error: "Broadcast not found." };

    if (broadcast.status === "sent") {
      let requeued: { id: string }[];
      try {
        requeued = await db.query<{ id: string }>(
          `update broadcast_recipients
              set status = 'pending', error = null, claimed_at = null, sent_at = null
            where broadcast_id = $1
              and status = 'failed'
              and error not ilike 'Invalid phone%'
              and error not ilike 'Interrupted%'
            returning id`,
          [broadcastId],
        );
      } catch {
        return { error: "Could not prepare the retry." };
      }
      if (requeued.length === 0) {
        return {
          error:
            "Nothing can be retried: the failed recipients have an invalid number, or their message may already have been delivered.",
        };
      }
      await db.execute(
        "update broadcasts set status = 'sending' where id = $1 and status = 'sent'",
        [broadcastId],
      );
    } else if (broadcast.status !== "sending") {
      return { error: "Only a broadcast that has been sent can be retried." };
    }

    const progress = await processBroadcast(broadcastId, SEND_NOW_BUDGET_MS);
    return { success: true, ...progress };
  } catch (err: unknown) {
    console.error("[broadcast] Retry failed:", err);
    return { error: "Could not retry the broadcast." };
  }
}

export interface ProcessedBroadcastResult {
  broadcastId: string;
  success: boolean;
  error?: string;
  total?: number;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  remaining?: number;
}

export interface DispatchDueBroadcastsSummary {
  success: boolean;
  error?: string;
  processedCount: number;
  results: ProcessedBroadcastResult[];
}

/**
 * Scheduler entry point (every 5 minutes): starts broadcasts whose time has
 * come, then continues every broadcast that is still sending.
 */
export async function dispatchDueBroadcasts(): Promise<DispatchDueBroadcastsSummary> {
  const runDeadline = Date.now() + SCHEDULER_BUDGET_MS;
  const results: ProcessedBroadcastResult[] = [];

  let dueBroadcasts: { id: string }[];
  try {
    dueBroadcasts = await db.query<{ id: string }>(
      `select id from broadcasts
        where status = 'scheduled' and scheduled_for <= $1 and deleted_at is null
        order by scheduled_for asc`,
      [new Date().toISOString()],
    );
  } catch (fetchError: unknown) {
    return {
      success: false,
      error: (fetchError instanceof Error && fetchError.message) || "Failed to fetch due broadcasts",
      processedCount: 0,
      results: [],
    };
  }

  for (const broadcast of dueBroadcasts) {
    const started = await startBroadcast(broadcast.id, "scheduled");
    // Errors here happen before anything is sent; the broadcast stays
    // "scheduled" and a later run tries again.
    if (started.error) {
      results.push({ broadcastId: broadcast.id, success: false, error: started.error });
    }
  }

  // A failed lookup here is treated as "nothing is sending".
  const sending = await db
    .query<{ id: string }>(
      `select id from broadcasts
        where status = 'sending' and deleted_at is null
        order by created_at asc`,
    )
    .catch(() => [] as { id: string }[]);

  for (const broadcast of sending) {
    const budget = runDeadline - Date.now();
    if (budget <= DEADLINE_MARGIN_MS) break;
    try {
      const progress = await processBroadcast(broadcast.id, budget);
      results.push({
        broadcastId: broadcast.id,
        success: true,
        total: progress.total,
        sentCount: progress.sent,
        failedCount: progress.failed,
        skippedCount: progress.skipped,
        remaining: progress.remaining,
      });
    } catch (err: unknown) {
      results.push({
        broadcastId: broadcast.id,
        success: false,
        error: err instanceof Error ? err.message : "Failed to dispatch broadcast",
      });
    }
  }

  return { success: true, processedCount: results.length, results };
}

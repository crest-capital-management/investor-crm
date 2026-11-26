/**
 * WhatsApp integration helpers using Meta Graph API.
 */

/**
 * Normalizes a phone number for WhatsApp messaging.
 * - Strips any non-digit characters (+, -, spaces, parentheses)
 * - Removes leading 0 if present (e.g. 09876543210 -> 9876543210)
 * - Prepends "91" (India country code) if the number is exactly 10 digits
 * - Validates that the resulting string is between 10 and 15 digits
 * Returns normalized phone digits or null if invalid.
 */
export function normalizePhoneForWhatsApp(phone: string): string | null {
  if (!phone || typeof phone !== "string") return null;

  // Strip non-digit characters
  let digits = phone.replace(/\D/g, "");

  // If it starts with 0 and followed by 10 digits, strip leading 0
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }

  // Prepend India country code if exactly 10 digits
  if (digits.length === 10) {
    digits = `91${digits}`;
  }

  // Validate standard E.164 without leading plus: 10 to 15 digits
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
}

/**
 * Normalizes a phone number to local CRM format (10-digit Indian number).
 * - Strips any non-digit characters (+, -, spaces, parentheses)
 * - Removes leading 0 if present (e.g. 09876543210 -> 9876543210)
 * - Removes leading "91" if present and followed by 10 digits (e.g. 919876543210 -> 9876543210)
 * Returns the cleaned digits or null if invalid/empty.
 */
export function normalizeToLocalPhone(phone: string): string | null {
  if (!phone || typeof phone !== "string") return null;

  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  // If it starts with 0 and followed by 10 digits, strip leading 0
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }

  // If it starts with 91 and followed by 10 digits, strip country code 91
  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  }

  return digits;
}

export interface SendWhatsAppMessageParams {
  to: string;
  message: string;
}

export interface WhatsAppApiResponse {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    error_data?: unknown;
    fbtrace_id?: string;
  };
}

/**
 * Sends a free-form text message via Meta's WhatsApp Cloud API.
 * Requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in environment.
 */
export async function sendWhatsAppMessage({
  to,
  message,
}: SendWhatsAppMessageParams): Promise<WhatsAppApiResponse> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  }
  if (!phoneNumberId) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");
  }

  const normalizedTo = normalizePhoneForWhatsApp(to);
  if (!normalizedTo) {
    throw new Error(`Invalid recipient phone number: "${to}".`);
  }

  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "text",
      text: {
        body: message,
      },
    }),
  });

  const data: WhatsAppApiResponse = await response.json();

  if (!response.ok || data.error) {
    const errMsg =
      data.error?.message ||
      `WhatsApp API responded with HTTP status ${response.status}`;
    throw new Error(errMsg);
  }

  return data;
}

export interface SendWhatsAppTemplateMessageParams {
  to: string;
  templateName: string;
  language: string;
  /** Values for the body's {{1}}, {{2}}, ... placeholders, in order. */
  bodyParameters: string[];
  /** For a template with an image, video or document header: the file, uploaded with uploadWhatsAppMedia. */
  headerMedia?: TemplateHeaderMedia;
}

/** Header kinds of a Meta template that need a file sent with every message. */
export type TemplateMediaHeaderFormat = "IMAGE" | "VIDEO" | "DOCUMENT";

export const TEMPLATE_MEDIA_HEADER_FORMATS: readonly TemplateMediaHeaderFormat[] = ["IMAGE", "VIDEO", "DOCUMENT"];

export function isTemplateMediaHeaderFormat(value: unknown): value is TemplateMediaHeaderFormat {
  return typeof value === "string" && (TEMPLATE_MEDIA_HEADER_FORMATS as readonly string[]).includes(value);
}

export interface TemplateHeaderMedia {
  format: TemplateMediaHeaderFormat;
  mediaId: string;
  /** Shown to the recipient for a document header. */
  filename?: string;
}

/**
 * Sends a Meta-approved message template. Unlike free-form text, templates
 * can be sent outside the 24-hour customer service window.
 */
export async function sendWhatsAppTemplateMessage({
  to,
  templateName,
  language,
  bodyParameters,
  headerMedia,
}: SendWhatsAppTemplateMessageParams): Promise<WhatsAppApiResponse> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");

  const normalizedTo = normalizePhoneForWhatsApp(to);
  if (!normalizedTo) {
    throw new Error(`Invalid recipient phone number: "${to}".`);
  }

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  };
  const components: Record<string, unknown>[] = [];
  if (headerMedia) {
    const type = headerMedia.format.toLowerCase();
    const media: Record<string, unknown> = { id: headerMedia.mediaId };
    if (headerMedia.format === "DOCUMENT" && headerMedia.filename) media.filename = headerMedia.filename;
    components.push({ type: "header", parameters: [{ type, [type]: media }] });
  }
  if (bodyParameters.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParameters.map((text) => ({ type: "text", text })),
    });
  }
  if (components.length > 0) template.components = components;

  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "template",
      template,
    }),
  });

  const data: WhatsAppApiResponse = await response.json();

  if (!response.ok || data.error) {
    const errMsg =
      data.error?.message ||
      `WhatsApp API responded with HTTP status ${response.status}`;
    throw new Error(errMsg);
  }

  return data;
}

export interface MetaMessageTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  parameter_format?: string;
  components?: Array<{
    type: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type: string; text?: string; url?: string; example?: unknown }>;
  }>;
}

/** Lists every message template on the WhatsApp Business Account. */
export async function fetchWhatsAppMessageTemplates(): Promise<MetaMessageTemplate[]> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const accountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  if (!accountId) throw new Error("WHATSAPP_BUSINESS_ACCOUNT_ID is not configured.");

  const templates: MetaMessageTemplate[] = [];
  let url: string | null =
    `https://graph.facebook.com/v25.0/${accountId}/message_templates` +
    `?fields=id,name,status,category,language,parameter_format,components&limit=100`;

  while (url) {
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(
        data.error?.message ||
          `WhatsApp API responded with HTTP status ${response.status}`,
      );
    }
    templates.push(...((data.data ?? []) as MetaMessageTemplate[]));
    url = data.paging?.next ?? null;
  }

  return templates;
}

export type WhatsAppMediaType = "image" | "video" | "audio" | "document";

/** File types by extension, for files read back from storage (which keeps no type with the name). */
export const MIME_BY_EXTENSION: Record<string, string> = {
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
 * Maps a browser/file MIME type to the WhatsApp Cloud API media category.
 * Returns null for unsupported types.
 */
export function mimeTypeToWhatsAppMediaType(
  mimeType: string
): WhatsAppMediaType | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("application/") ||
    mimeType === "text/plain" ||
    mimeType === "text/csv"
  ) {
    return "document";
  }
  return null;
}

/**
 * Uploads a file's raw bytes to Meta so it can be referenced by ID in a
 * subsequent send. Required before sending any media message.
 */
export async function uploadWhatsAppMedia(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), filename);

  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/media`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errMsg =
      data.error?.message ||
      `WhatsApp media upload responded with HTTP status ${response.status}`;
    throw new Error(errMsg);
  }

  return data.id as string;
}

export interface SendWhatsAppMediaMessageParams {
  to: string;
  /** Either an uploaded media ID or a public https link to the file. */
  mediaId?: string;
  link?: string;
  mediaType: WhatsAppMediaType;
  filename?: string;
  caption?: string;
}

/**
 * Sends a previously uploaded media file (see uploadWhatsAppMedia) to a
 * recipient via Meta's WhatsApp Cloud API.
 */
export async function sendWhatsAppMediaMessage({
  to,
  mediaId,
  link,
  mediaType,
  filename,
  caption,
}: SendWhatsAppMediaMessageParams): Promise<WhatsAppApiResponse> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");

  const normalizedTo = normalizePhoneForWhatsApp(to);
  if (!normalizedTo) {
    throw new Error(`Invalid recipient phone number: "${to}".`);
  }

  if (!mediaId && !link) throw new Error("A media ID or link is required.");
  const mediaObject: Record<string, unknown> = mediaId ? { id: mediaId } : { link };
  if (caption && (mediaType === "image" || mediaType === "video" || mediaType === "document")) {
    mediaObject.caption = caption;
  }
  if (filename && mediaType === "document") {
    mediaObject.filename = filename;
  }

  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: mediaType,
      [mediaType]: mediaObject,
    }),
  });

  const data: WhatsAppApiResponse = await response.json();

  if (!response.ok || data.error) {
    const errMsg =
      data.error?.message ||
      `WhatsApp API responded with HTTP status ${response.status}`;
    throw new Error(errMsg);
  }

  return data;
}

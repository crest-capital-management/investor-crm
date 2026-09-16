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

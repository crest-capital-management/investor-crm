/**
 * Email helper using Resend, for internal notifications (e.g. the daily
 * follow-up reminder). Not related to WhatsApp messaging.
 */
import { Resend } from "resend";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends a transactional email via Resend.
 * Requires RESEND_API_KEY and RESEND_FROM_EMAIL in environment.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is not configured.");
  }

  const resend = new Resend(apiKey);

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(error.message || "Failed to send email via Resend.");
  }

  return data;
}

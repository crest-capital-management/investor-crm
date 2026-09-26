"use server";

import { createServiceRoleClient } from "@/lib/supabase-service";
import { sendEmail } from "@/lib/resend";
import { requireActionAuth } from "@/lib/auth";

export interface DueFollowUpRow {
  id: string;
  due_date: string;
  message: string;
  contact_id: string;
  contact_name: string;
}

function todayAsISODate() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReminderEmailHtml(rows: DueFollowUpRow[], today: string) {
  const overdue = rows.filter((r) => r.due_date < today);
  const dueToday = rows.filter((r) => r.due_date === today);

  const renderRows = (list: DueFollowUpRow[]) =>
    list
      .map(
        (r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.contact_name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.due_date)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.message)}</td>
        </tr>`,
      )
      .join("");

  const section = (title: string, list: DueFollowUpRow[]) => {
    if (list.length === 0) return "";
    return `
      <h2 style="font-size:16px;margin:24px 0 8px;">${escapeHtml(title)} (${list.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #d1d5db;">Investor</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #d1d5db;">Due date</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #d1d5db;">Follow-up</th>
          </tr>
        </thead>
        <tbody>${renderRows(list)}</tbody>
      </table>`;
  };

  return `
    <div style="font-family:sans-serif;color:#111827;max-width:640px;">
      <h1 style="font-size:18px;">CREST CRM — Follow-up Reminder</h1>
      <p style="font-size:14px;color:#4b5563;">Here are your open follow-ups as of ${escapeHtml(today)}.</p>
      ${section("Overdue", overdue)}
      ${section("Due today", dueToday)}
    </div>`;
}

export interface DispatchFollowUpRemindersSummary {
  success: boolean;
  dueCount: number;
  emailed: boolean;
  error?: string;
}

/**
 * Finds all pending follow-ups due today or earlier and emails a single
 * digest to the configured reminder recipient. Intended to be called once a
 * day (manually for now; see /api/follow-ups/trigger for the protected
 * endpoint used once a scheduler is wired up).
 */
export async function dispatchDueFollowUpReminders(): Promise<DispatchFollowUpRemindersSummary> {
  const supabase = createServiceRoleClient();
  const today = todayAsISODate();

  const { data, error } = await supabase
    .from("follow_ups")
    .select("id, due_date, message, contact_id, contacts(name)")
    .eq("is_done", false)
    .is("deleted_at", null)
    .lte("due_date", today)
    .order("due_date", { ascending: true });

  if (error) {
    return {
      success: false,
      dueCount: 0,
      emailed: false,
      error: error.message || "Failed to fetch due follow-ups.",
    };
  }

  const rows: DueFollowUpRow[] = (data ?? []).map((row) => {
    const contact = row.contacts as unknown as { name: string } | { name: string }[] | null;
    const contactName = Array.isArray(contact) ? contact[0]?.name : contact?.name;
    return {
      id: row.id,
      due_date: row.due_date,
      message: row.message,
      contact_id: row.contact_id,
      contact_name: contactName || "Unknown investor",
    };
  });

  if (rows.length === 0) {
    return { success: true, dueCount: 0, emailed: false };
  }

  const recipient = process.env.REMINDER_EMAIL_TO;
  if (!recipient) {
    return {
      success: false,
      dueCount: rows.length,
      emailed: false,
      error: "REMINDER_EMAIL_TO is not configured.",
    };
  }

  try {
    await sendEmail({
      to: recipient,
      subject: `CREST CRM: ${rows.length} follow-up${rows.length === 1 ? "" : "s"} due`,
      html: buildReminderEmailHtml(rows, today),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send reminder email.";
    return { success: false, dueCount: rows.length, emailed: false, error: message };
  }

  return { success: true, dueCount: rows.length, emailed: true };
}

/**
 * Authenticated wrapper for manually testing the reminder email from the UI
 * (e.g. a "Send test reminder" button on the dashboard). This is separate
 * from the /api/follow-ups/trigger route, which is for an unattended
 * scheduler call and is not wired up yet.
 */
export async function sendTestFollowUpReminder() {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  const summary = await dispatchDueFollowUpReminders();
  if (!summary.success) {
    return { error: summary.error || "Failed to send reminder email." };
  }
  if (!summary.emailed) {
    return { success: true, message: "No follow-ups are due today — nothing was emailed." };
  }
  return {
    success: true,
    message: `Reminder email sent with ${summary.dueCount} due follow-up${summary.dueCount === 1 ? "" : "s"}.`,
  };
}

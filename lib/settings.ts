import { db } from "@/lib/db";

export type AppSettings = {
  reminderEmailEnabled: boolean;
  /** Overrides the REMINDER_EMAIL_TO env var when set. */
  reminderEmailTo: string | null;
  reminderIncludeFollowUps: boolean;
  reminderIncludeUnread: boolean;
  notifyMessages: boolean;
  notifyFollowUps: boolean;
  notifyBroadcasts: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  reminderEmailEnabled: true,
  reminderEmailTo: null,
  reminderIncludeFollowUps: true,
  reminderIncludeUnread: true,
  notifyMessages: true,
  notifyFollowUps: true,
  notifyBroadcasts: true,
};

/**
 * Loads the settings row. Falls back to the defaults if there is no row yet
 * or it can't be read, so the rest of the app keeps working.
 */
export async function getAppSettings(): Promise<AppSettings> {
  type Row = {
    reminder_email_enabled: boolean | null;
    reminder_email_to: string | null;
    reminder_include_followups: boolean | null;
    reminder_include_unread: boolean | null;
    notify_messages: boolean | null;
    notify_followups: boolean | null;
    notify_broadcasts: boolean | null;
  };
  let data: Row | null;
  try {
    data = await db.maybeOne<Row>(
      `select reminder_email_enabled, reminder_email_to, reminder_include_followups, reminder_include_unread,
              notify_messages, notify_followups, notify_broadcasts
         from app_settings where id = 'default'`,
    );
  } catch {
    return DEFAULT_APP_SETTINGS;
  }

  if (!data) return DEFAULT_APP_SETTINGS;

  return {
    reminderEmailEnabled: data.reminder_email_enabled ?? true,
    reminderEmailTo: data.reminder_email_to?.trim() || null,
    reminderIncludeFollowUps: data.reminder_include_followups ?? true,
    reminderIncludeUnread: data.reminder_include_unread ?? true,
    notifyMessages: data.notify_messages ?? true,
    notifyFollowUps: data.notify_followups ?? true,
    notifyBroadcasts: data.notify_broadcasts ?? true,
  };
}

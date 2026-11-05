"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { AppSettings } from "@/lib/settings";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveAppSettings(settings: AppSettings) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) return { error: "Unauthorized" };

  const reminderEmailTo = settings.reminderEmailTo?.trim() || null;
  if (reminderEmailTo && !EMAIL_PATTERN.test(reminderEmailTo)) {
    return { error: "Enter a valid email address for the reminder." };
  }

  try {
    await db.execute(
      `insert into app_settings (
         id, reminder_email_enabled, reminder_email_to, reminder_include_followups, reminder_include_unread,
         notify_messages, notify_followups, notify_broadcasts, updated_at
       ) values ('default', $1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         reminder_email_enabled = excluded.reminder_email_enabled,
         reminder_email_to = excluded.reminder_email_to,
         reminder_include_followups = excluded.reminder_include_followups,
         reminder_include_unread = excluded.reminder_include_unread,
         notify_messages = excluded.notify_messages,
         notify_followups = excluded.notify_followups,
         notify_broadcasts = excluded.notify_broadcasts,
         updated_at = excluded.updated_at`,
      [
        Boolean(settings.reminderEmailEnabled),
        reminderEmailTo,
        Boolean(settings.reminderIncludeFollowUps),
        Boolean(settings.reminderIncludeUnread),
        Boolean(settings.notifyMessages),
        Boolean(settings.notifyFollowUps),
        Boolean(settings.notifyBroadcasts),
        new Date().toISOString(),
      ],
    );
  } catch {
    return {
      error:
        "Settings could not be saved. If you have not yet run the app_settings migration in Supabase, run it first.",
    };
  }

  revalidatePath("/my-profile");
  return { success: true as const };
}

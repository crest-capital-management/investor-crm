import { dispatchDueFollowUpReminders } from "@/lib/follow-up-reminders";
import { schedulerRoute } from "@/lib/scheduler-route";

/** Daily follow-up reminder email; called at 10:00 IST by the server's cron job. */
export const POST = schedulerRoute(dispatchDueFollowUpReminders, "Failed to process follow-up reminders");

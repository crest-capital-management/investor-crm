import { saveDailyBackup } from "@/lib/backup";
import { schedulerRoute } from "@/lib/scheduler-route";

/** Nightly backup, called by the server's cron job (see azure/SWITCHOVER.md). */
export const POST = schedulerRoute(async () => ({ success: true, ...(await saveDailyBackup()) }), "Backup failed");

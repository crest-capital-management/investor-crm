import { dispatchDueBroadcasts } from "@/lib/broadcast-dispatch";
import { schedulerRoute } from "@/lib/scheduler-route";

/** Sends scheduled broadcasts that are due; called every 5 minutes by the server's cron job. */
export const POST = schedulerRoute(dispatchDueBroadcasts, "Failed to process broadcasts");

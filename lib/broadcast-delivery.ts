import { db } from "@/lib/db";

/** What WhatsApp reported after a broadcast was accepted for sending. */
export interface BroadcastDeliveryResults {
  /** Recipients whose WhatsApp message ID was saved (broadcasts sent before the update have none). */
  tracked: number;
  /** Accepted by WhatsApp, no delivery report yet. */
  waiting: number;
  delivered: number;
  read: number;
  failed: number;
  failures: Array<{ name: string; reason: string }>;
  /** At least one message failed because of a WhatsApp billing problem (code 131042). */
  billingProblem: boolean;
  /** Messages WhatsApp held back because the person received too many marketing messages (code 131049). */
  marketingLimited: number;
}

const CHUNK = 100;

/** Reads each recipient's later delivery result from the chat history. */
export async function getBroadcastDeliveryResults(
  broadcastId: string
): Promise<BroadcastDeliveryResults | null> {
  let recipients: Array<{ name: string | null; wamid: string | null }>;
  try {
    recipients = await db.query<{ name: string | null; wamid: string | null }>(
      `select name, wamid
         from broadcast_recipients
        where broadcast_id = $1 and status = 'sent' and wamid is not null
        order by id`,
      [broadcastId],
    );
  } catch {
    return null; // the wamid column doesn't exist yet
  }
  if (recipients.length === 0) return null;

  const nameByWamid = new Map<string, string>();
  for (const r of recipients) if (r.wamid) nameByWamid.set(r.wamid, r.name ?? "Unknown");
  const wamids = [...nameByWamid.keys()];

  const results: BroadcastDeliveryResults = {
    tracked: wamids.length,
    waiting: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    failures: [],
    billingProblem: false,
    marketingLimited: 0,
  };

  const seen = new Set<string>();
  for (let i = 0; i < wamids.length; i += CHUNK) {
    let rows: Array<{ wamid: string | null; status: string | null; status_error: string | null }> = [];
    try {
      rows = await db.query(
        `select wamid, status, status_error
           from whatsapp_messages
          where wamid = any($1::text[])`,
        [wamids.slice(i, i + CHUNK)],
      );
    } catch {
      // Same as before: a failed lookup leaves these recipients counted as waiting.
    }
    for (const row of rows) {
      if (!row.wamid) continue;
      seen.add(row.wamid);
      if (row.status === "read") results.read++;
      else if (row.status === "delivered") results.delivered++;
      else if (row.status === "failed") {
        results.failed++;
        const reason = row.status_error ?? "WhatsApp could not deliver this message.";
        if (/code 131042/.test(reason)) results.billingProblem = true;
        if (/code 131049/.test(reason)) results.marketingLimited++;
        if (results.failures.length < 100) {
          results.failures.push({ name: nameByWamid.get(row.wamid) ?? "Unknown", reason });
        }
      } else results.waiting++;
    }
  }
  // Recipients with no matching chat row yet count as waiting.
  results.waiting += wamids.filter((w) => !seen.has(w)).length;
  return results;
}

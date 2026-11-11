import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuthFast } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadBroadcastContactChoices } from "@/lib/sections";
import { BroadcastEditor } from "@/components/broadcast-editor";
import {
  BroadcastDeliveryResultsPanel,
  BroadcastSendReport,
  broadcastStatusDisplay,
} from "@/components/broadcast-send-summary";
import { getBroadcastDeliveryResults } from "@/lib/broadcast-delivery";
import { RetryFailedBroadcastButton } from "@/components/retry-failed-broadcast-button";
import type {
  GroupOption,
  TemplateOption,
  BroadcastData,
} from "@/app/broadcasts/actions";

export const metadata: Metadata = {
  title: "Broadcast Details",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BroadcastDetailPage({ params }: PageProps) {
  const { id } = await params;
  await requireAuthFast();

  // A failed lookup leaves that picker empty, as before; a failed broadcast lookup is "not found".
  const [broadcastRow, groups, contactChoices, templates] = await Promise.all([
    db
      .maybeOne<BroadcastData>("select * from broadcasts where id = $1 and deleted_at is null", [id])
      .catch(() => null),
    db.query<GroupOption>("select id, name from groups order by name asc").catch(() => []),
    loadBroadcastContactChoices(),
    db
      .query<TemplateOption>(
        `select id, name, category, body_text, variables, approved_at, meta_template_id
           from templates
          where deleted_at is null
          order by name asc`,
      )
      .catch(() => []),
  ]);

  if (!broadcastRow) {
    notFound();
  }

  const broadcast = broadcastRow;

  const isSent = broadcast.status === "sent";
  const isScheduled = broadcast.status === "scheduled";
  const isSending = broadcast.status === "sending";

  const deliveryResults = isSent ? await getBroadcastDeliveryResults(id) : null;

  // Progress of a broadcast that is going out in batches.
  let sendingProgress: { done: number; total: number } | null = null;
  if (isSending) {
    const progressCounts = await db
      .one<{ done: number; total: number }>(
        `select count(*) filter (where status in ('sent', 'skipped', 'failed'))::int as done,
                count(*)::int as total
           from broadcast_recipients
          where broadcast_id = $1
            and status in ('pending', 'sending', 'sent', 'skipped', 'failed')`,
        [id],
      )
      .catch(() => ({ done: 0, total: 0 }));
    const doneCount = progressCounts.done;
    const totalCount = progressCounts.total;
    sendingProgress = { done: doneCount, total: totalCount };
  }

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3">
        <div>
          <Link
            href="/broadcasts"
            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Broadcasts
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {isSent || isSending
                ? "Broadcast Details"
                : isScheduled
                ? "Edit Scheduled Broadcast"
                : "Edit Broadcast"}
            </h1>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
              {broadcastStatusDisplay(broadcast.status, broadcast.send_summary).label}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSent || isSending
              ? "View sent broadcast message and recipient target audience."
              : isScheduled
              ? "Modify your scheduled broadcast message, recipient targets, and send time."
              : "Modify your draft broadcast message and recipient targets."}
          </p>
        </div>
      </div>

      <div className="mt-6 max-w-4xl">
        {isSent && <BroadcastSendReport summary={broadcast.send_summary} />}
        {isSent && <BroadcastDeliveryResultsPanel results={deliveryResults} />}
        {isSent && (broadcast.send_summary?.failed ?? 0) > 0 && (
          <RetryFailedBroadcastButton broadcastId={id} failedCount={broadcast.send_summary?.failed ?? 0} />
        )}
        {sendingProgress && (
          <section className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-5 text-sm">
            <h2 className="text-base font-semibold">Sending in batches</h2>
            <p className="mt-1 text-muted-foreground">
              {sendingProgress.done} of {sendingProgress.total} recipients done. It continues
              automatically every few minutes; refresh to see progress. The delivery report
              appears here when it finishes.
            </p>
          </section>
        )}
        <BroadcastEditor
          mode="edit"
          existingBroadcast={broadcast}
          groups={groups}
          contacts={contactChoices.contacts}
          sections={contactChoices.sections}
          templates={templates}
        />
      </div>
    </div>
  );
}

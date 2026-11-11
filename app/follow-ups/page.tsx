import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireAuthFast } from "@/lib/auth";
import { db } from "@/lib/db";
import { isInvestorTag } from "@/lib/tags";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Follow-ups",
};

type FollowUpRow = {
  id: string;
  contact_id: string;
  contact_name: string | null;
  contact_tags: string[] | null;
  due_date: string;
  message: string;
};

type Status = "today" | "pending" | "overdue";

function formatDueDate(dueDate: string) {
  const [year, month, day] = String(dueDate).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(dueDate);
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status: Status = statusParam === "overdue" || statusParam === "today" ? statusParam : "pending";
  await requireAuthFast();

  const todayStr = new Date().toISOString().slice(0, 10);

  let rows: FollowUpRow[] = [];
  let loadError: string | null = null;
  try {
    rows = await db.query<FollowUpRow>(
      `select f.id, f.contact_id, c.name as contact_name, c.tags as contact_tags,
              f.due_date::text as due_date, f.message
       from public.follow_ups f
       left join public.contacts c on c.id = f.contact_id and c.deleted_at is null
       where f.is_done = false and f.deleted_at is null
         ${status === "overdue" ? "and f.due_date < $1::date" : status === "today" ? "and f.due_date = $1::date" : ""}
       order by f.due_date asc`,
      status === "pending" ? [] : [todayStr],
    );
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Follow-ups could not be loaded.";
  }

  const tabs: Array<{ key: Status; label: string }> = [
    { key: "today", label: "Today" },
    { key: "pending", label: "Pending" },
    { key: "overdue", label: "Overdue" },
  ];

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>
      <h1 className="text-2xl font-semibold">Follow-ups</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {status === "overdue"
          ? "Follow-ups past their due date."
          : status === "today"
            ? "Follow-ups due today."
            : "All follow-ups awaiting completion."}
      </p>

      <div className="mt-4 flex gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/follow-ups?status=${tab.key}`}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              status === tab.key
                ? "border-foreground bg-foreground text-background"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {loadError ? (
        <p className="mt-6 text-destructive">Error loading follow-ups: {loadError}</p>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {status === "overdue"
            ? "No overdue follow-ups. All caught up."
            : status === "today"
              ? "No follow-ups due today."
              : "No pending follow-ups."}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {rows.length} follow-up{rows.length === 1 ? "" : "s"}
          </p>
          {rows.map((row) => {
            const isOverdue = row.due_date.slice(0, 10) < todayStr;
            const base = row.contact_tags?.some((tag) => isInvestorTag(tag)) ? "investors" : "contacts";
            return (
              <div
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between",
                  isOverdue && "border-destructive/30",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{row.contact_name ?? "Deleted contact"}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        isOverdue ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isOverdue ? `Overdue (${formatDueDate(row.due_date)})` : `Due ${formatDueDate(row.due_date)}`}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.message}</p>
                </div>
                {row.contact_name ? (
                  <Link
                    href={`/${base}/${row.contact_id}#followup-${row.id}`}
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Open follow-up
                    <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import {
  Users,
  TrendingUp,
  Clock,
  AlertCircle,
  MessageSquare,
  ArrowUpRight,
  Calendar,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type ContactItem = {
  id: string;
  name: string;
  tags?: string[] | null;
};

type FollowUpRecord = {
  id: string;
  contact_id: string;
  due_date: string;
  message: string;
  is_done: boolean;
  created_at: string;
};

type InteractionRecord = {
  id: string;
  contact_id: string;
  type: string;
  note: string;
  created_at: string;
};

function formatDueDate(dueDate: string) {
  if (!dueDate) return "No date";
  const [year, month, day] = dueDate.split("-").map(Number);
  if (!year || !month || !day) return dueDate;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatActivityDate(isoString: string) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DashboardPage() {
  const { supabase } = await requireAuth();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

  const [contactsResult, followUpsResult, interactionsResult] =
    await Promise.all([
      supabase.from("contacts").select("id, name, tags"),
      supabase
        .from("follow_ups")
        .select("id, contact_id, due_date, message, is_done, created_at")
        .eq("is_done", false)
        .order("due_date", { ascending: true }),
      supabase
        .from("interactions")
        .select("id, contact_id, type, note, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const { data: contacts, error: contactsError } = contactsResult;
  const { data: pendingFollowUps, error: followUpsError } = followUpsResult;
  const { data: interactions, error: interactionsError } = interactionsResult;

  if (contactsError || followUpsError || interactionsError) {
    const errorMsg =
      contactsError?.message ||
      followUpsError?.message ||
      interactionsError?.message;
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-destructive">
          Error loading dashboard data: {errorMsg}
        </p>
      </div>
    );
  }

  // Lookup map for contacts
  const contactsMap = new Map<
    string,
    { id: string; name: string; isInvestor: boolean }
  >();

  let investorCount = 0;
  for (const contact of (contacts ?? []) as ContactItem[]) {
    const isInvestor = Boolean(
      Array.isArray(contact.tags) &&
        contact.tags.some(
          (tag: string) => tag.trim().toLowerCase() === "investor"
        )
    );
    if (isInvestor) {
      investorCount++;
    }
    contactsMap.set(contact.id, {
      id: contact.id,
      name: contact.name,
      isInvestor,
    });
  }

  const totalContacts = contacts?.length ?? 0;
  const pendingCount = pendingFollowUps?.length ?? 0;
  const overdueCount = (pendingFollowUps ?? []).filter(
    (f: FollowUpRecord) => f.due_date && f.due_date < todayStr
  ).length;

  const recentInteractionsCount = (interactions ?? []).filter(
    (i: InteractionRecord) => i.created_at >= thirtyDaysAgoIso
  ).length;

  const summaryCards = [
    {
      label: "Total Contacts",
      value: totalContacts,
      subtext: "In CRM database",
      icon: Users,
      highlight: false,
    },
    {
      label: "Investors",
      value: investorCount,
      subtext: `${totalContacts ? Math.round((investorCount / totalContacts) * 100) : 0}% of contact base`,
      icon: TrendingUp,
      highlight: false,
    },
    {
      label: "Pending Follow-ups",
      value: pendingCount,
      subtext: "Awaiting completion",
      icon: Clock,
      highlight: false,
    },
    {
      label: "Overdue Follow-ups",
      value: overdueCount,
      subtext: overdueCount > 0 ? "Requires attention" : "All caught up",
      icon: AlertCircle,
      highlight: overdueCount > 0,
    },
    {
      label: "Recent Interactions",
      value: recentInteractionsCount,
      subtext: "Last 30 days",
      icon: MessageSquare,
      highlight: false,
    },
  ];

  // Upcoming follow-ups (next 8)
  const upcomingFollowUps = ((pendingFollowUps ?? []) as FollowUpRecord[]).slice(
    0,
    8
  );

  // Latest interactions (next 8)
  const latestInteractions = ((interactions ?? []) as InteractionRecord[]).slice(
    0,
    8
  );

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview of your investor pipeline and latest follow-ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/investors"
            className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            View All Investors
          </Link>
        </div>
      </div>

      {/* 5 Summary Cards */}
      <div className="mt-4 grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={cn(
                "flex flex-col justify-between rounded-lg border bg-background p-4 shadow-sm transition-colors",
                card.highlight && "border-destructive/40 bg-destructive/5"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {card.label}
                </span>
                <Icon
                  className={cn(
                    "h-4 w-4 text-muted-foreground",
                    card.highlight && "text-destructive"
                  )}
                />
              </div>
              <div className="mt-2">
                <p
                  className={cn(
                    "text-2xl font-semibold tracking-tight",
                    card.highlight && "text-destructive"
                  )}
                >
                  {card.value}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {card.subtext}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Sections: Upcoming Follow-ups & Recent Activity */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Section 1: Upcoming Follow-ups */}
        <div className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-card-foreground">
                Upcoming Follow-ups
              </h2>
            </div>
            <Link
              href="/investors"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Manage &rarr;
            </Link>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {upcomingFollowUps.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No pending follow-ups scheduled.
              </div>
            ) : (
              upcomingFollowUps.map((item) => {
                const contact = contactsMap.get(item.contact_id);
                const contactName = contact?.name ?? "Unknown Contact";
                const isInvestor = contact?.isInvestor ?? false;
                const isOverdue = item.due_date && item.due_date < todayStr;
                const isToday = item.due_date === todayStr;

                const CardContent = (
                  <div
                    className={cn(
                      "flex flex-col gap-1.5 rounded-lg border bg-background p-3.5 transition-colors",
                      isInvestor &&
                        "cursor-pointer hover:border-foreground/20 hover:bg-muted/30",
                      isOverdue && "border-destructive/30"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-medium text-sm text-foreground">
                          {contactName}
                        </span>
                        {isInvestor && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Investor
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            isOverdue && "bg-destructive/10 text-destructive",
                            isToday &&
                              "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                            !isOverdue &&
                              !isToday &&
                              "bg-secondary text-secondary-foreground"
                          )}
                        >
                          {isOverdue
                            ? `Overdue (${formatDueDate(item.due_date)})`
                            : isToday
                              ? "Due Today"
                              : formatDueDate(item.due_date)}
                        </span>
                        {isInvestor && (
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {item.message || "No follow-up message provided."}
                    </p>
                  </div>
                );

                return isInvestor ? (
                  <Link
                    key={item.id}
                    href={`/investors/${item.contact_id}`}
                    className="block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-lg"
                  >
                    {CardContent}
                  </Link>
                ) : (
                  <div key={item.id}>{CardContent}</div>
                );
              })
            )}
          </div>
        </div>

        {/* Section 2: Recent Activity */}
        <div className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-card-foreground">
                Recent Activity
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">
              Latest touchpoints
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {latestInteractions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No activity recorded yet.
              </div>
            ) : (
              latestInteractions.map((interaction) => {
                const contact = contactsMap.get(interaction.contact_id);
                const contactName = contact?.name ?? "Unknown Contact";
                const isInvestor = contact?.isInvestor ?? false;
                const isMeeting = interaction.type === "meeting";

                return (
                  <div
                    key={interaction.id}
                    className="flex flex-col gap-1.5 rounded-lg border bg-background p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isInvestor ? (
                          <Link
                            href={`/investors/${interaction.contact_id}`}
                            className="truncate font-medium text-sm text-foreground hover:underline"
                          >
                            {contactName}
                          </Link>
                        ) : (
                          <span className="truncate font-medium text-sm text-foreground">
                            {contactName}
                          </span>
                        )}

                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            isMeeting
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {isMeeting ? "Meeting" : "Follow-up Completed"}
                        </span>
                      </div>

                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatActivityDate(interaction.created_at)}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-3">
                      {interaction.note || "No note recorded."}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type WhatsAppMessage = {
  id: string;
  direction: string;
  message_text: string | null;
  media_url: string | null;
  sent_at: string | null;
  created_at: string;
};

export type WhatsAppHistoryProps = {
  messages: WhatsAppMessage[];
  error?: string | null;
  isLoading?: boolean;
  className?: string;
};

function formatWhatsAppDate(sentAt: string | null, createdAt: string) {
  const timestamp = sentAt || createdAt;
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "—";

  return `${date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} · ${date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`;
}

export function WhatsAppHistory({
  messages,
  error = null,
  isLoading = false,
  className,
}: WhatsAppHistoryProps) {
  return (
    <section className={cn("rounded-lg border bg-background p-5", className)}>
      <div>
        <h2 className="text-base font-semibold">WhatsApp History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Message history with this contact.
        </p>
      </div>
      <div className="mt-5">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading WhatsApp messages...</p>
        ) : messages.length ? (
          <div className="space-y-4">
            {messages.map((message) => {
              const isInbound =
                message.direction === "in" ||
                message.direction?.toLowerCase() === "inbound";
              const hasText = Boolean(
                message.message_text && message.message_text.trim(),
              );

              return (
                <div
                  key={message.id}
                  className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        isInbound
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {isInbound ? (
                        <>
                          <ArrowDownLeft className="size-3" />
                          Inbound
                        </>
                      ) : (
                        <>
                          <ArrowUpRight className="size-3" />
                          Outbound
                        </>
                      )}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {formatWhatsAppDate(message.sent_at, message.created_at)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    {hasText ? (
                      <p className="whitespace-pre-wrap text-sm">
                        {message.message_text}
                      </p>
                    ) : message.media_url ? (
                      <p className="text-sm italic text-muted-foreground">
                        [Media message]
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No WhatsApp messages yet.</p>
        )}
      </div>
    </section>
  );
}

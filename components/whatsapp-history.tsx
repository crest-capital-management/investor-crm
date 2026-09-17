"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const [open, setOpen] = useState(false);

  const hasMessages = messages.length > 0;
  const lastMessage = hasMessages ? messages[messages.length - 1] : null;

  const isLastInbound =
    lastMessage?.direction === "in" ||
    lastMessage?.direction?.toLowerCase() === "inbound";

  const lastMessageText = lastMessage
    ? lastMessage.message_text && lastMessage.message_text.trim()
      ? lastMessage.message_text
      : lastMessage.media_url
      ? "[Media message]"
      : "No text"
    : "";

  return (
    <>
      <section className={cn("rounded-lg border bg-background p-5", className)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">WhatsApp History</h2>
              {hasMessages && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {messages.length} {messages.length === 1 ? "message" : "messages"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Message history with this contact.
            </p>
          </div>

          {hasMessages && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="shrink-0"
            >
              View Full History
            </Button>
          )}
        </div>

        <div className="mt-4">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading WhatsApp messages...
            </p>
          ) : hasMessages && lastMessage ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Latest Message</span>
                <span>
                  Last message:{" "}
                  {formatWhatsAppDate(lastMessage.sent_at, lastMessage.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    isLastInbound
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {isLastInbound ? (
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
                <p className="truncate text-xs text-foreground/80 flex-1">
                  {lastMessageText}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No WhatsApp messages yet.
            </p>
          )}
        </div>
      </section>

      {/* Full WhatsApp History Sheet Panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="border-b px-4 py-3.5 sm:px-6 sm:py-5">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg sm:text-xl">
                WhatsApp History
              </SheetTitle>
              {hasMessages && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {messages.length} {messages.length === 1 ? "message" : "messages"}
                </span>
              )}
            </div>
            <SheetDescription className="text-sm">
              Message history with this contact.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            <div className="space-y-4">
              {messages.map((message) => {
                const isInbound =
                  message.direction === "in" ||
                  message.direction?.toLowerCase() === "inbound";
                const hasText = Boolean(
                  message.message_text && message.message_text.trim()
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
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
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
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

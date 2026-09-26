"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

import { sendTestFollowUpReminder } from "@/app/follow-ups/actions";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";

export function SendTestReminderButton() {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  async function handleClick() {
    setSending(true);
    const result = await sendTestFollowUpReminder();
    setSending(false);

    if ("error" in result && result.error) {
      toast(result.error, "error");
      return;
    }
    toast(result.message ?? "Reminder check complete.", "success");
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={sending}>
      <Mail className="size-4" />
      {sending ? "Sending…" : "Send test reminder email"}
    </Button>
  );
}

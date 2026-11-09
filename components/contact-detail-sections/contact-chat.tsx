"use client";

import { useState } from "react";

import {
  generateWhatsAppSummary,
  prepareWhatsAppMediaUpload,
  resendFailedWhatsAppMessage,
  sendWhatsAppMediaFromStorage,
  sendWhatsAppReply,
  sendWhatsAppTemplateToContact,
} from "@/app/contacts/actions";
import { useToast } from "@/components/toast-provider";
import { WhatsAppHistory, type WhatsAppMessage } from "@/components/whatsapp-history";
import { markReadAndNotify, MESSAGES_CHANGED_EVENT } from "@/lib/unread-events";
import { uploadFile } from "@/lib/upload-to-storage";

/** Tells the rest of the app (lists, badges) that a message was sent; the chat shows it itself. */
function notifyMessagesChanged() {
  window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
}

/** The WhatsApp chat for one contact: history, AI summary, replies, files, templates and resends. */
export function ContactChat({
  contactId,
  contactName,
  initialMessages,
  error,
  initialSummary,
  initialSummaryGeneratedAt,
  unreadCount,
}: {
  contactId: string;
  contactName: string;
  initialMessages: WhatsAppMessage[];
  error: string | null;
  initialSummary: string | null;
  initialSummaryGeneratedAt: string | null;
  unreadCount: number;
}) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState<string | null>(initialSummaryGeneratedAt);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);

  async function handleRefreshSummary() {
    setIsGeneratingSummary(true);
    setSummaryError(null);
    try {
      const result = await generateWhatsAppSummary(contactId);
      if ("error" in result && result.error) {
        setSummaryError(result.error);
        toast(result.error, "error");
      } else if ("success" in result && result.success) {
        setSummary(result.summary);
        setSummaryGeneratedAt(result.generatedAt);
        toast("WhatsApp summary updated.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate summary.";
      setSummaryError(msg);
      toast(msg, "error");
    } finally {
      setIsGeneratingSummary(false);
    }
  }

  async function handleSendReply(message: string) {
    setIsSendingReply(true);
    try {
      const result = await sendWhatsAppReply(contactId, message);
      if ("error" in result && result.error) {
        return { error: result.error };
      }
      toast("Message sent.");
      notifyMessagesChanged();
      return { message: "message" in result ? result.message : undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send message.";
      return { error: msg };
    } finally {
      setIsSendingReply(false);
    }
  }

  async function handleResendMessage(messageId: string) {
    const result = await resendFailedWhatsAppMessage(messageId);
    if ("error" in result && result.error) {
      toast(result.error, "error");
      return { error: result.error };
    }
    toast("Message sent again.");
    notifyMessagesChanged();
    return { message: "message" in result ? result.message : undefined };
  }

  async function handleSendTemplate(templateId: string, params: string[]) {
    const result = await sendWhatsAppTemplateToContact(contactId, templateId, params);
    if ("error" in result && result.error) {
      return { error: result.error };
    }
    toast("Template sent.");
    notifyMessagesChanged();
    return { message: "message" in result ? result.message : undefined };
  }

  async function handleSendMedia(file: File, caption: string) {
    setIsSendingMedia(true);
    try {
      const prepared = await prepareWhatsAppMediaUpload(contactId, file.name, file.type, file.size);
      if ("error" in prepared) return { error: prepared.error };

      // The file goes to the CRM's upload route, which saves it to storage.
      if (!(await uploadFile(prepared.uploadUrl, file))) {
        return { error: "The file could not be uploaded. Please try again." };
      }

      const result = await sendWhatsAppMediaFromStorage(contactId, prepared.path, file.type, file.name, caption);
      if ("error" in result && result.error) {
        return { error: result.error };
      }
      toast("File sent.");
      notifyMessagesChanged();
      return { message: "message" in result ? result.message : undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send file.";
      return { error: msg };
    } finally {
      setIsSendingMedia(false);
    }
  }

  return (
    <WhatsAppHistory
      messages={initialMessages}
      error={error}
      summary={summary}
      summaryGeneratedAt={summaryGeneratedAt}
      onRefreshSummary={handleRefreshSummary}
      isGeneratingSummary={isGeneratingSummary}
      summaryError={summaryError}
      onSendReply={handleSendReply}
      isSendingReply={isSendingReply}
      onSendMedia={handleSendMedia}
      isSendingMedia={isSendingMedia}
      onOpened={() => void markReadAndNotify(contactId)}
      unreadCount={unreadCount}
      onSendTemplate={handleSendTemplate}
      onResendMessage={handleResendMessage}
      contactName={contactName}
    />
  );
}

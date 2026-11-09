import { markConversationRead } from "@/app/unread-messages/actions";

// Fired on `window` whenever the unread-conversation state may have changed,
// so the sidebar badge can refresh without waiting for its next poll.
export const UNREAD_CHANGED_EVENT = "crm:unread-changed";

// Fired when WhatsApp messages were added or changed (pushed live by the
// database, or after the user sends something), so open chats and contact
// lists can refresh straight away.
export const MESSAGES_CHANGED_EVENT = "crm:messages-changed";

/**
 * Optional detail on MESSAGES_CHANGED_EVENT. `newMessages: false` means only
 * delivery statuses changed (sent → delivered → read), which open chats show but
 * contact lists don't. A plain Event (no detail) counts as new messages.
 */
export type MessagesChangedDetail = { newMessages: boolean };

export function isNewMessagesEvent(event: Event): boolean {
  const detail = (event as CustomEvent<MessagesChangedDetail | undefined>).detail;
  return detail?.newMessages !== false;
}

export async function markReadAndNotify(contactId: string) {
  await markConversationRead(contactId);
  window.dispatchEvent(new Event(UNREAD_CHANGED_EVENT));
}

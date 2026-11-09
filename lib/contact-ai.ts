import { askClaude, parseClaudeJson } from "@/lib/claude";
import { chronological, isInbound } from "@/lib/ai-context";

export type ChatMessageForSummary = {
  direction: string;
  message_text: string | null;
  sent_at: string | null;
  created_at: string;
};

function formatHistory(messages: ChatMessageForSummary[]) {
  return chronological(messages)
    .map((m) => {
      const label = isInbound(m.direction) ? "Contact (Inbound)" : "Team (Outbound)";
      const text = m.message_text && m.message_text.trim() ? m.message_text.trim() : "[Media / non-text message]";
      return `[${m.sent_at || m.created_at}] ${label}: ${text}`;
    })
    .join("\n");
}

/**
 * Generates an AI summary of a contact's WhatsApp conversation history.
 * At most 2 short sentences (under 40 words total), with an optional next step.
 */
export async function generateChatSummary(messages: ChatMessageForSummary[]): Promise<string> {
  if (!messages || messages.length === 0) {
    throw new Error("No messages provided to summarize.");
  }

  const prompt = `You are an AI assistant for CREST Capital Management's investor CRM.
Summarize this WhatsApp conversation in at most 2 short sentences (under 40 words total). Be direct and specific — no filler phrases like "the contact" or "the team". If there's a clear next step or pending action, end with a separate short line starting with "Next: ". Reply with the summary only, in plain text (no markdown, no heading).

WhatsApp Conversation History:
${formatHistory(messages)}`;

  return askClaude({ prompt, effort: "low" });
}

export type MeetingNoteForFollowUp = {
  note: string;
  created_at: string;
};

export type FollowUpSuggestion =
  | { needed: true; dueDate: string; message: string }
  | { needed: false };

const FOLLOW_UP_SCHEMA = {
  type: "object",
  properties: {
    needed: { type: "boolean" },
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD when needed, otherwise null" },
    message: { type: ["string", "null"], description: "short follow-up action when needed, otherwise null" },
  },
  required: ["needed", "due_date", "message"],
  additionalProperties: false,
};

/**
 * Decides, from a contact's WhatsApp history and meeting notes, whether a
 * follow-up is warranted, and if so drafts a due date and message. Only a
 * suggestion — nothing is saved until the user confirms it in Add Follow-up.
 */
export async function generateFollowUpSuggestion(
  messages: ChatMessageForSummary[],
  meetingNotes: MeetingNoteForFollowUp[],
  todayIsoDate: string,
): Promise<FollowUpSuggestion> {
  if (messages.length === 0 && meetingNotes.length === 0) {
    throw new Error("No WhatsApp history or meeting notes to work from.");
  }

  const formattedNotes = meetingNotes.length
    ? [...meetingNotes]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((n) => `[${n.created_at}] ${n.note.trim()}`)
        .join("\n")
    : "(none)";

  const prompt = `You are an AI assistant for CREST Capital Management's investor CRM. Today's date is ${todayIsoDate}.

Based on the WhatsApp conversation history and meeting notes below, decide whether a follow-up action is currently warranted for this investor (e.g. there's an open commitment, an unanswered question, a promised next step, or it's been a while since contact with a clear pending item). If nothing warrants following up, say so.

WhatsApp Conversation History:
${messages.length ? formatHistory(messages) : "(none)"}

Meeting Notes:
${formattedNotes}

Answer with JSON. If no follow-up is needed: needed = false, due_date = null, message = null.
If one is needed: needed = true, due_date = a real calendar date on or after ${todayIsoDate} in YYYY-MM-DD format, message = a short, specific follow-up action under 25 words.`;

  const result = parseClaudeJson(await askClaude({ prompt, effort: "low", jsonSchema: FOLLOW_UP_SCHEMA }));

  if (result.needed === false) return { needed: false };

  if (
    result.needed === true &&
    typeof result.due_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(result.due_date) &&
    typeof result.message === "string" &&
    result.message.trim()
  ) {
    return { needed: true, dueDate: result.due_date, message: result.message.trim() };
  }

  throw new Error("The AI returned an incomplete follow-up suggestion.");
}

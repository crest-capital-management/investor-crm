import { askClaude, parseClaudeJson } from "@/lib/claude";
import { toIndianGrouping } from "@/lib/indian-numbers";
import { chronological, clip as clipText, isInbound, type ContactHistory } from "@/lib/ai-context";

// Gives up before the host would cut the request off, so the card shows a clear error.
const DRAFT_TIMEOUT_MS = 30_000;
const MAX_MESSAGES = 15;
const MAX_TEXT_CHARS = 400;
// WhatsApp allows far more, but a personal note should stay short.
const MAX_DRAFT_CHARS = 1000;

const DRAFT_SCHEMA = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
};

export type DraftInput = ContactHistory & {
  todayIsoDate: string;
  contact: {
    name: string;
    company: string | null;
    tags: string[] | null;
    notes: string | null;
  };
};

const clip = (text: string) => clipText(text, MAX_TEXT_CHARS);

function formatMessages(messages: DraftInput["messages"]) {
  const recent = chronological(messages).slice(-MAX_MESSAGES);
  if (recent.length === 0) return "(no WhatsApp messages yet)";
  return recent
    .map((m) => {
      const text = m.message_text?.trim() ? clip(m.message_text) : "[media / non-text message]";
      return `[${m.sent_at || m.created_at}] ${isInbound(m.direction) ? "Contact" : "Team"}: ${text}`;
    })
    .join("\n");
}

/**
 * Drafts a short, personal WhatsApp message to a contact from their tags,
 * notes and recent conversation. Only a draft: the owner edits it, then copies
 * or sends it.
 */
export async function draftMessage(input: DraftInput): Promise<string> {
  const notes = [...input.meetingNotes]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-3)
    .map((n) => `[${n.created_at}] ${clip(n.note)}`)
    .join("\n");
  const openFollowUps = input.followUps
    .filter((f) => !f.is_done)
    .map((f) => `due ${f.due_date}: ${clip(f.message)}`)
    .join("\n");

  const prompt = `You write WhatsApp messages for CREST Capital Management, an Indian investment advisory / PMS / family-office firm. Today's date is ${input.todayIsoDate}.

Write ONE message from the CREST team to this contact. Style: warm and short, like a personal note from a person who knows them, not a marketing blast.
- 2 to 4 sentences, under 90 words. Address them by first name.
- Mention their situation naturally (their tag or company, and the last conversation if there is one) so it clearly isn't generic.
- If the contact's last message was a question or request that is still unanswered, acknowledge it. Do not promise anything the facts below don't support.
- End with one clear, low-pressure next step (for example a short call, or asking if they'd like an update).
- Use ONLY the facts below. Never invent facts, figures, meetings or past conversations. If very little is known, write a light, friendly check-in.
- Never promise or predict investment returns or performance. No emojis, no markdown, no hashtags, no subject line, no placeholders like [Name].
- Write rupee amounts in the Indian number system (lakh and crore, e.g. ₹57,56,422 or ₹57.56 lakh), never millions or billions.
- Do not sign off with a name.

CONTACT
Name: ${input.contact.name}
Company: ${input.contact.company || "(not given)"}
Tags: ${input.contact.tags?.length ? input.contact.tags.join(", ") : "(none)"}
Notes: ${input.contact.notes?.trim() ? clip(input.contact.notes) : "(none)"}

RECENT WHATSAPP CONVERSATION (oldest first)
${formatMessages(input.messages)}

RECENT MEETING NOTES
${notes || "(none)"}

OPEN FOLLOW-UPS
${openFollowUps || "(none)"}

Respond with ONLY one JSON object: {"message": string}`;

  const result = parseClaudeJson(
    await askClaude({ prompt, effort: "low", jsonSchema: DRAFT_SCHEMA, timeoutMs: DRAFT_TIMEOUT_MS }),
  );
  const message = typeof result.message === "string" ? result.message.trim() : "";
  if (!message) throw new Error("The AI returned an unexpected response format.");
  return toIndianGrouping(message).slice(0, MAX_DRAFT_CHARS);
}

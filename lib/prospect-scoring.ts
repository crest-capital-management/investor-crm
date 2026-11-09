import { askClaude, parseClaudeJson } from "@/lib/claude";
import { toIndianGrouping } from "@/lib/indian-numbers";
import type { PortfolioAnalysis } from "@/lib/portfolio-types";
import { chronological, clip as clipText, isInbound, type ContactHistory } from "@/lib/ai-context";

// Gives up before the host would cut the request off, so the card shows a clear error.
const SCORING_TIMEOUT_MS = 30_000;
const MAX_MESSAGES = 30;
const MAX_NOTES = 10;
const MAX_TEXT_CHARS = 400;

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "1 to 5" },
    reason: { type: "string" },
  },
  required: ["score", "reason"],
  additionalProperties: false,
};

export type ScoringInput = ContactHistory & {
  todayIsoDate: string;
  contact: {
    name: string;
    company: string | null;
    tags: string[] | null;
    notes: string | null;
    date_saved: string | null;
  };
  portfolio: PortfolioAnalysis | null;
};

export type ScoringResult = { score: number; reason: string };

const clip = (text: string) => clipText(text, MAX_TEXT_CHARS);

function formatMessages(messages: ScoringInput["messages"]) {
  const recent = chronological(messages).slice(-MAX_MESSAGES);
  if (recent.length === 0) return "(no WhatsApp messages)";
  const inbound = messages.filter((m) => isInbound(m.direction)).length;
  const lines = recent.map((m) => {
    const text = m.message_text?.trim() ? clip(m.message_text) : "[media / non-text message]";
    return `[${m.sent_at || m.created_at}] ${isInbound(m.direction) ? "Contact" : "Team"}: ${text}`;
  });
  return `${messages.length} messages in total, ${inbound} from the contact. Latest ${recent.length}:\n${lines.join("\n")}`;
}

function formatPortfolio(portfolio: PortfolioAnalysis | null) {
  if (!portfolio) return "(no portfolio update attached)";
  return JSON.stringify({
    aum: portfolio.aum.display ?? portfolio.aum.value,
    as_of: portfolio.aum.as_of,
    returns: portfolio.returns.display ?? portfolio.returns.pct,
    returns_period: portfolio.returns.period,
    summary: portfolio.summary,
  });
}

/**
 * Suggests a 1-5 fit score for a prospect from what the CRM knows about them,
 * with a short reason. Only a suggestion: the owner can override it.
 */
export async function scoreProspect(input: ScoringInput): Promise<ScoringResult> {
  const notes = [...input.meetingNotes]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-MAX_NOTES)
    .map((n) => `[${n.created_at}] ${clip(n.note)}`)
    .join("\n");
  const followUps = input.followUps
    .map((f) => `${f.is_done ? "[done]" : "[open]"} due ${f.due_date}: ${clip(f.message)}`)
    .join("\n");

  const prompt = `You are an analyst assistant for CREST Capital Management, an Indian investment advisory / PMS / family-office firm. Today's date is ${input.todayIsoDate}.

Score how good a prospect this contact is for CREST on a 1 to 5 scale:
5 = Hot: strong capacity and clear interest, act now.
4 = Strong: good fit, worth active follow-up.
3 = Promising: potential, but unclear or not enough information.
2 = Weak: low interest or limited fit so far.
1 = Poor: poor fit or no engagement.

Weigh these factors: (1) capacity - wealth signals such as HNI / Family Office / Founder tags, company, portfolio AUM; (2) engagement - whether they reply, how often, how recent the last contact is; (3) intent - interest shown in meeting notes and open or completed follow-ups; (4) fit with CREST's offering; (5) how much information exists.
Use ONLY the facts below. Never invent facts. If there is very little information, say "not enough information" in the reason and lean to 3 rather than guessing high or low.

CONTACT
Name: ${input.contact.name}
Company: ${input.contact.company || "(not given)"}
Tags: ${input.contact.tags?.length ? input.contact.tags.join(", ") : "(none)"}
Saved on: ${input.contact.date_saved ?? "(unknown)"}
Notes: ${input.contact.notes?.trim() ? clip(input.contact.notes) : "(none)"}

WHATSAPP
${formatMessages(input.messages)}

MEETING NOTES
${notes || "(none)"}

FOLLOW-UPS
${followUps || "(none)"}

LATEST PORTFOLIO UPDATE
${formatPortfolio(input.portfolio)}

Respond with ONLY one JSON object: {"score": integer 1-5, "reason": string}
The reason is 2-3 short sentences naming the specific facts that drove the score (and what is missing, if relevant). No markdown. Write rupee amounts in the Indian number system (lakh and crore, e.g. ₹57,56,422 or ₹57.56 lakh), never millions or billions.`;

  const result = parseClaudeJson(
    await askClaude({ prompt, effort: "low", jsonSchema: SCORE_SCHEMA, timeoutMs: SCORING_TIMEOUT_MS }),
  );
  const score = typeof result.score === "number" ? Math.round(result.score) : NaN;
  const reason = typeof result.reason === "string" ? result.reason.trim() : "";
  if (!Number.isInteger(score) || score < 1 || score > 5 || !reason) {
    throw new Error("The AI returned an unexpected response format.");
  }
  return { score, reason: toIndianGrouping(reason) };
}

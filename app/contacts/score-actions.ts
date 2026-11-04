"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";
import { db, isMissingSchemaError } from "@/lib/db";
import type { PortfolioAnalysis } from "@/lib/portfolio-types";
import { scoreProspect, type ScoringInput } from "@/lib/prospect-scoring";
import {
  MAX_SCORE_REASON_CHARS,
  PROSPECT_SCORE_COLUMNS,
  type ProspectScore,
} from "@/lib/prospect-score-types";

const MISSING_COLUMN_ERROR = "Prospect score isn't set up yet. Run the latest Supabase migration (prospect score) first.";

function isMissingColumn(error: unknown) {
  return isMissingSchemaError(error) || /ai_score|manual_score/.test((error as { message?: string } | null)?.message ?? "");
}

function revalidateContact(contactId: string) {
  revalidatePath("/contacts");
  revalidatePath("/investors");
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath(`/investors/${contactId}`);
}

/** Asks the AI for a score and reason from everything the CRM knows about the contact, and saves it as the AI suggestion. */
export async function suggestProspectScore(
  contactId: string,
): Promise<{ score: ProspectScore } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  const id = contactId.trim();
  let contact: ScoringInput["contact"] | null;
  try {
    contact = await db.maybeOne<ScoringInput["contact"]>(
      `select id, name, company, tags, notes, date_saved from public.contacts where id = $1 and deleted_at is null`,
      [id],
    );
  } catch {
    contact = null;
  }
  if (!contact) return { error: "The contact could not be found." };

  let messages: ScoringInput["messages"];
  let notes: ScoringInput["meetingNotes"];
  let followUps: ScoringInput["followUps"];
  try {
    [messages, notes, followUps] = await Promise.all([
      db.query<ScoringInput["messages"][number]>(
        `select direction, message_text, sent_at, created_at
           from public.whatsapp_messages
          where contact_id = $1 and deleted_at is null
          order by sent_at asc`,
        [id],
      ),
      db.query<ScoringInput["meetingNotes"][number]>(
        `select note, created_at
           from public.interactions
          where contact_id = $1 and type = 'meeting' and deleted_at is null
          order by created_at asc`,
        [id],
      ),
      db.query<ScoringInput["followUps"][number]>(
        `select due_date, message, is_done
           from public.follow_ups
          where contact_id = $1 and deleted_at is null`,
        [id],
      ),
    ]);
  } catch {
    return { error: "Could not load the contact's messages, notes or follow-ups." };
  }

  // The table may not exist yet; the score works without portfolio data.
  let portfolio: PortfolioAnalysis | null = null;
  try {
    const row = await db.maybeOne<{ analysis: PortfolioAnalysis | null }>(
      `select analysis from public.portfolio_updates
        where contact_id = $1 and analysis_status = 'done' and deleted_at is null
        order by created_at desc limit 1`,
      [id],
    );
    portfolio = row?.analysis ?? null;
  } catch {
    portfolio = null;
  }

  let result: { score: number; reason: string };
  try {
    result = await scoreProspect({
      todayIsoDate: new Date().toISOString().slice(0, 10),
      contact,
      messages,
      meetingNotes: notes,
      followUps,
      portfolio,
    });
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "The score could not be generated." };
  }

  let saved: ProspectScore;
  try {
    saved = await db.one<ProspectScore>(
      `update public.contacts
          set ai_score = $2, ai_score_reason = $3, ai_scored_at = $4
        where id = $1
        returning ${PROSPECT_SCORE_COLUMNS}`,
      [id, result.score, result.reason, new Date().toISOString()],
    );
  } catch (error) {
    return { error: isMissingColumn(error) ? MISSING_COLUMN_ERROR : "The score could not be saved." };
  }

  revalidateContact(id);
  return { score: saved };
}

/** Saves the owner's own score and reason, which takes precedence over the AI suggestion. */
export async function setManualScore(
  contactId: string,
  score: number,
  reason: string,
): Promise<{ score: ProspectScore } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: "Choose a score from 1 to 5." };
  const cleanReason = reason.trim();
  if (cleanReason.length > MAX_SCORE_REASON_CHARS) {
    return { error: `Please keep the reason under ${MAX_SCORE_REASON_CHARS} characters.` };
  }

  const id = contactId.trim();
  let saved: ProspectScore;
  try {
    saved = await db.one<ProspectScore>(
      `update public.contacts
          set manual_score = $2, manual_score_reason = $3, manual_scored_at = $4
        where id = $1 and deleted_at is null
        returning ${PROSPECT_SCORE_COLUMNS}`,
      [id, score, cleanReason || null, new Date().toISOString()],
    );
  } catch (error) {
    return { error: isMissingColumn(error) ? MISSING_COLUMN_ERROR : "The score could not be saved." };
  }

  revalidateContact(id);
  return { score: saved };
}

/** Removes the owner's override so the AI suggestion applies again. */
export async function clearManualScore(
  contactId: string,
): Promise<{ score: ProspectScore } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  const id = contactId.trim();
  let saved: ProspectScore;
  try {
    saved = await db.one<ProspectScore>(
      `update public.contacts
          set manual_score = null, manual_score_reason = null, manual_scored_at = null
        where id = $1 and deleted_at is null
        returning ${PROSPECT_SCORE_COLUMNS}`,
      [id],
    );
  } catch (error) {
    return { error: isMissingColumn(error) ? MISSING_COLUMN_ERROR : "The override could not be removed." };
  }

  revalidateContact(id);
  return { score: saved };
}

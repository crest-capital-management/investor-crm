"use server";

import { requireActionAuth } from "@/lib/auth";
import { db, isMissingSchemaError } from "@/lib/db";
import { analyzePortfolioUpdate, portfolioFileKind } from "@/lib/portfolio-analysis";
import {
  MAX_PORTFOLIO_FILE_BYTES,
  PORTFOLIO_UPDATE_COLUMNS,
  type PortfolioAnalysis,
  type PortfolioUpdate,
} from "@/lib/portfolio-types";
import {
  createPortfolioUploadTarget,
  downloadPortfolioFile,
  removePortfolioFile,
  uploadPortfolioFile,
} from "@/lib/supabase-storage";

const MAX_PASTED_CHARS = 100_000;
const MISSING_TABLE_ERROR =
  "Portfolio updates aren't set up yet. Run the latest Supabase migration (portfolio_updates) first.";

function isMissingTable(error: unknown) {
  return isMissingSchemaError(error) || /portfolio_updates/.test((error as { message?: string } | null)?.message ?? "");
}

async function findContact(id: string): Promise<{ id: string } | null> {
  try {
    return await db.maybeOne<{ id: string }>("select id from public.contacts where id = $1", [id]);
  } catch {
    return null;
  }
}

/** Step 1: checks the file and returns a one-time address so the browser uploads straight to storage. */
export async function preparePortfolioUpload(
  contactId: string,
  filename: string,
  size: number,
): Promise<{ path: string; token: string } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  if (!size) return { error: "No file selected." };
  if (size > MAX_PORTFOLIO_FILE_BYTES) return { error: "File is too large. Please choose a file under 15MB." };
  const kind = portfolioFileKind(filename, null);
  if (!kind || kind === "text") return { error: "Please choose a PDF, Excel (.xlsx) or CSV file." };

  const contact = await findContact(contactId.trim());
  if (!contact) return { error: "The contact could not be found." };

  try {
    return await createPortfolioUploadTarget(contact.id, filename);
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Could not prepare the upload." };
  }
}

/** Step 2: the file is in storage; records it as an update waiting for analysis. */
export async function createPortfolioUpdate(
  contactId: string,
  path: string,
  fileName: string,
  mimeType: string,
  size: number,
): Promise<{ id: string } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  const id = contactId.trim();
  if (!path.startsWith(`${id}/`) || path.includes("..")) return { error: "That file isn't available for this contact." };

  try {
    const data = await db.one<{ id: string }>(
      `insert into public.portfolio_updates (contact_id, file_path, file_name, mime_type, size_bytes, source)
       values ($1, $2, $3, $4, $5, 'file')
       returning id`,
      [id, path, fileName, mimeType || null, size],
    );
    return { id: data.id };
  } catch (error) {
    return { error: isMissingTable(error) ? MISSING_TABLE_ERROR : "The update could not be saved." };
  }
}

/** Saves pasted text as a text attachment. Analysis is a separate call, like for files. */
export async function createPortfolioUpdateFromText(
  contactId: string,
  text: string,
  title: string,
): Promise<{ id: string } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  const id = contactId.trim();
  const body = text.trim();
  if (!body) return { error: "Paste the update text first." };
  if (body.length > MAX_PASTED_CHARS) return { error: "That text is too long. Please paste under 100,000 characters." };

  const contact = await findContact(id);
  if (!contact) return { error: "The contact could not be found." };

  const cleanTitle = title.trim().slice(0, 80);
  const fileName = `${(cleanTitle || "Pasted update").replace(/[^a-zA-Z0-9._ -]/g, "_")}.txt`;
  const path = `${id}/${Date.now()}-pasted.txt`;
  try {
    await uploadPortfolioFile(path, Buffer.from(body, "utf8"), "text/plain");
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "The update could not be saved." };
  }

  try {
    const data = await db.one<{ id: string }>(
      `insert into public.portfolio_updates (contact_id, title, file_path, file_name, mime_type, size_bytes, source)
       values ($1, $2, $3, $4, 'text/plain', $5, 'paste')
       returning id`,
      [id, cleanTitle || null, path, fileName, Buffer.byteLength(body, "utf8")],
    );
    return { id: data.id };
  } catch (error) {
    await removePortfolioFile(path);
    return { error: isMissingTable(error) ? MISSING_TABLE_ERROR : "The update could not be saved." };
  }
}

/**
 * Reads the stored file with AI and saves the analysis. The previous analysed
 * update for the same contact (the one just before this in time) is used for
 * the "change versus previous" comparison.
 */
export async function analyzePortfolioUpdateById(
  updateId: string,
): Promise<{ update: PortfolioUpdate } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  type UpdateRow = { id: string; contact_id: string; file_path: string; file_name: string; mime_type: string | null; created_at: string };
  let row: UpdateRow | null;
  try {
    row = await db.maybeOne<UpdateRow>(
      `select id, contact_id, file_path, file_name, mime_type, created_at
         from public.portfolio_updates
        where id = $1 and deleted_at is null`,
      [updateId],
    );
  } catch {
    row = null;
  }
  if (!row) return { error: "The update could not be found." };

  let previousRow: { analysis: PortfolioAnalysis | null; title: string | null; file_name: string; created_at: string } | null;
  try {
    previousRow = await db.maybeOne(
      `select analysis, title, file_name, created_at
         from public.portfolio_updates
        where contact_id = $1 and analysis_status = 'done' and deleted_at is null and created_at < $2
        order by created_at desc
        limit 1`,
      [row.contact_id, row.created_at],
    );
  } catch {
    previousRow = null;
  }

  let analysis: PortfolioAnalysis | null = null;
  let failure: string | null = null;
  try {
    const buffer = await downloadPortfolioFile(row.file_path);
    analysis = await analyzePortfolioUpdate({
      buffer,
      fileName: row.file_name,
      mimeType: row.mime_type,
      previousAnalysis: previousRow?.analysis ?? null,
      previousLabel: previousRow ? (previousRow.title ?? previousRow.file_name) : null,
    });
  } catch (err: unknown) {
    failure = err instanceof Error ? err.message : "The analysis failed.";
  }

  let saved: PortfolioUpdate;
  try {
    saved = analysis
      ? await db.one<PortfolioUpdate>(
          `update public.portfolio_updates
              set analysis = $2::jsonb, analysis_status = 'done', analysis_error = null, as_of_date = $3
            where id = $1
            returning ${PORTFOLIO_UPDATE_COLUMNS}`,
          [row.id, JSON.stringify(analysis), asOfDate(analysis.aum.as_of)],
        )
      : await db.one<PortfolioUpdate>(
          `update public.portfolio_updates
              set analysis_status = 'failed', analysis_error = $2
            where id = $1
            returning ${PORTFOLIO_UPDATE_COLUMNS}`,
          [row.id, failure],
        );
  } catch {
    return { error: "The analysis could not be saved." };
  }
  if (failure) return { error: failure };
  return { update: saved };
}

function asOfDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function deletePortfolioUpdate(updateId: string): Promise<{ success: true } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  try {
    await db.execute("update public.portfolio_updates set deleted_at = $2 where id = $1", [updateId, new Date().toISOString()]);
  } catch {
    return { error: "The update could not be deleted." };
  }
  return { success: true };
}

/** The contact's current updates, so the page can pick up an analysis that finished in the background. */
export async function listPortfolioUpdates(
  contactId: string,
): Promise<{ updates: PortfolioUpdate[] } | { error: string }> {
  const { error: authError } = await requireActionAuth();
  if (authError) return { error: "Unauthorized" };

  try {
    const updates = await db.query<PortfolioUpdate>(
      `select ${PORTFOLIO_UPDATE_COLUMNS}
         from public.portfolio_updates
        where contact_id = $1 and deleted_at is null
        order by created_at desc`,
      [contactId.trim()],
    );
    return { updates };
  } catch {
    return { error: "Portfolio updates could not be loaded." };
  }
}

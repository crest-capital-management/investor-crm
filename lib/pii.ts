import { blindIndex, decryptField, decryptJson } from "@/lib/encryption";
import { param } from "@/lib/sql";
import { normalizeToLocalPhone } from "@/lib/whatsapp";

/**
 * Lookup hash for a phone number (contacts / whatsapp_messages /
 * broadcast_recipients .phone_hash). Numbers are compared in the canonical form
 * normalizeToLocalPhone gives, the form contacts.phone is saved in.
 */
export function phoneHash(phone: string | null | undefined): string | null {
  return blindIndex("phone", phone ? normalizeToLocalPhone(phone) : null);
}

/**
 * SQL condition "this row's phone is `phone`" for a table with phone + phone_hash.
 * Matches by hash; rows saved before their hash was filled in
 * (azure/encrypt-columns.mjs --hash-only) still match by the plain number, so
 * nothing is missed while the data is being migrated.
 *
 * `alias` is the table alias with its dot ("c."), or "" for none.
 */
export function phoneMatch(alias: string, params: unknown[], phone: string): string {
  const local = normalizeToLocalPhone(phone);
  const plain = [...new Set([local, phone.replace(/\D/g, "")].filter(Boolean))] as string[];
  const hash = param(params, phoneHash(phone));
  const raw = param(params, plain);
  return `(${alias}phone_hash = ${hash} or (${alias}phone_hash is null and ${alias}phone = any(${raw}::text[])))`;
}

const nameCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * A to Z by name, then by id so the order is stable. Replaces SQL
 * "order by name, id", which would sort the encrypted text.
 */
export function sortByName<T extends { name?: string | null; id?: string }>(rows: T[]): T[] {
  return rows.sort(
    (a, b) => nameCollator.compare(a.name ?? "", b.name ?? "") || (a.id ?? "").localeCompare(b.id ?? ""),
  );
}

/** Case-insensitive "contains" over the given fields; replaces SQL ILIKE on encrypted columns. */
export function matchesSearch(values: Array<string | null | undefined>, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

/**
 * Decrypts contact name/phone inside JSON built by SQL (json_build_object),
 * which lib/db.ts does not decrypt automatically.
 */
export function decryptJsonContact<T extends { name?: string | null; phone?: string | null } | null>(contact: T): T {
  if (!contact) return contact;
  return { ...contact, name: decryptField(contact.name), phone: decryptField(contact.phone) };
}

/**
 * portfolio_updates.analysis is jsonb: older rows hold the analysis object,
 * encrypted rows hold the encrypted text as a JSON string. Both read the same.
 */
export function withDecryptedAnalysis<T extends { analysis?: unknown }>(row: T): T {
  return row && "analysis" in row ? { ...row, analysis: decryptJson(row.analysis) } : row;
}

/** The chat-list preview of a message (the trigger stores encrypted text whole, so it is shortened here). */
export function messagePreview(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

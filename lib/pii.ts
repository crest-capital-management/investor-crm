import { blindIndex, decryptField, decryptJson, encryptField, normalizeEmail } from "@/lib/encryption";
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

/** Lookup hash for an email (contacts.email_hash), compared trimmed and lower-cased. */
export function emailHash(email: string | null | undefined): string | null {
  return blindIndex("email", normalizeEmail(email));
}

/** Lookup hash for one tag (contacts.tag_hashes). Tags are compared exactly, trimmed. */
export function tagHash(tag: string | null | undefined): string | null {
  return blindIndex("tag", tag?.trim() || null);
}

/**
 * The values to store for a contact's tags: contacts.tags (each tag encrypted)
 * and contacts.tag_hashes (one lookup hash per tag). Empty and repeated tags
 * are dropped. Bind as `$n::text[]`.
 */
export function tagColumns(tags: readonly string[]): { tags: string[]; tagHashes: string[] } {
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  return { tags: unique.map((tag) => encryptField(tag)!), tagHashes: unique.map((tag) => tagHash(tag)!) };
}

/**
 * SQL condition "this contact has any of `tags`" (replaces `tags && $1::text[]`,
 * which can't compare encrypted tags). Matches by tag_hashes; rows whose hashes
 * are not filled in yet (azure/encrypt-columns.mjs 3 --hash-only) still match
 * by the plain tags, so nothing is missed while the data is being migrated.
 *
 * `alias` is the table alias with its dot ("c."), or "" for none.
 */
export function tagMatch(alias: string, params: unknown[], tags: readonly string[]): string {
  const hashes = param(params, tags.map((tag) => tagHash(tag)).filter((hash): hash is string => Boolean(hash)));
  const plain = param(params, [...tags]);
  return `(${alias}tag_hashes && ${hashes}::text[] or (${alias}tag_hashes is null and ${alias}tags && ${plain}::text[]))`;
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

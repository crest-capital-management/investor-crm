import { db } from "@/lib/db";
import { matchesSearch, sortByName } from "@/lib/pii";

type FilterRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  last_message_at: string | null;
};

/**
 * Contacts matching `where` (SQL over unencrypted columns, alias "c") and a
 * search term over name, phone, email and company. Those columns are
 * encrypted, so the search runs here on the decrypted values instead of ILIKE.
 */
export async function contactsMatching(where: string, params: unknown[], search: string): Promise<FilterRow[]> {
  const rows = await db.query<FilterRow>(
    `select c.id, c.name, c.phone, c.email, c.company, c.last_message_at from public.contacts c where ${where}`,
    params,
  );
  return search ? rows.filter((row) => matchesSearch([row.name, row.phone, row.email, row.company], search)) : rows;
}

/** Most recent chat first (no chat last), then A to Z, then id: the order needs the decrypted name. */
export function sortByRecentChatThenName<T extends FilterRow>(rows: T[]): T[] {
  const byName = sortByName([...rows]);
  const nameRank = new Map(byName.map((row, index) => [row.id, index]));
  return rows.sort((a, b) => {
    const at = a.last_message_at ? Date.parse(a.last_message_at) : -Infinity;
    const bt = b.last_message_at ? Date.parse(b.last_message_at) : -Infinity;
    if (at !== bt) return bt - at;
    return (nameRank.get(a.id) ?? 0) - (nameRank.get(b.id) ?? 0);
  });
}

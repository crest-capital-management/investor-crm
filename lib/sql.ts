/**
 * Small SQL building blocks that replace the PostgREST filter helpers.
 * Everything user-supplied goes through query parameters ($1, $2, ...), never into the SQL text.
 */

/** Escapes % _ and \ so a search term is matched literally inside ILIKE. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/**
 * Builds `(col1 ilike $n or col2 ilike $n ...)` for a "contains" search over several columns.
 * `params` is the parameter list being built; the search term is pushed onto it.
 */
export function ilikeAny(columns: string[], term: string, params: unknown[]): string {
  params.push(`%${escapeLike(term)}%`);
  const placeholder = `$${params.length}`;
  return `(${columns.map((column) => `${column} ilike ${placeholder}`).join(" or ")})`;
}

/** Adds a value to `params` and returns its placeholder, e.g. "$3". */
export function param(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

/** `limit`/`offset` for a 1-based page (same paging as lib/pagination.ts). */
export function pageClause(params: unknown[], page: number, pageSize: number): string {
  const limit = param(params, pageSize);
  const offset = param(params, (page - 1) * pageSize);
  return `limit ${limit} offset ${offset}`;
}

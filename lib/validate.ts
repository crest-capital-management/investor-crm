/** Input checks shared by forms (browser) and server actions. Pure functions. */

import { isUuid } from "@/lib/sql";

export { isUuid };

/** Message server actions return when an id is not a well-formed UUID. */
export const INVALID_ID_ERROR = "Invalid request.";

/**
 * True when any given id is not a well-formed UUID. Arrays are checked item by
 * item; null and undefined are skipped (optional ids). Server actions call this
 * right after the auth check so malformed ids never reach SQL.
 */
export function hasInvalidId(...values: (string | readonly string[] | null | undefined)[]): boolean {
  for (const value of values) {
    if (value == null) continue;
    const items = typeof value === "string" ? [value] : value;
    if (!Array.isArray(items)) return true;
    for (const item of items) {
      if (typeof item !== "string" || !isUuid(item.trim())) return true;
    }
  }
  return false;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(value.slice(0, 4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getUTCDate() === Number(value.slice(8, 10))
  );
}

/** Small text and date helpers shared by the server and the browser. */

/** Trims `value` and cuts it to at most `max` characters, ending with "…" when cut. */
export function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Today's date (UTC) as YYYY-MM-DD, the format due dates are stored in. */
export function todayAsISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Slows down password guessing on the login page: after MAX_FAILURES wrong
 * passwords from the same address (for any email, or for one email) within
 * WINDOW_MS, more attempts from that address are refused until the window has
 * passed. Counting by address rather than by email alone means someone else
 * cannot lock the owner out by typing the owner's email wrongly. Without an
 * address (no proxy header) it falls back to the email. Kept in memory, which is
 * enough for one long-running server; a restart clears it.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (kept.length) failures.set(key, kept);
  else failures.delete(key);
  return kept;
}

function keysFor(email: string, ip: string | null): string[] {
  return ip ? [`ip:${ip}`, `pair:${ip}|${email}`] : [`email:${email}`];
}

export function isLoginBlocked(email: string, ip: string | null): boolean {
  const now = Date.now();
  return keysFor(email, ip).some((key) => recent(key, now).length >= MAX_FAILURES);
}

export function recordLoginFailure(email: string, ip: string | null): void {
  const now = Date.now();
  for (const key of keysFor(email, ip)) failures.set(key, [...recent(key, now), now]);
}

export function clearLoginFailures(email: string, ip: string | null): void {
  for (const key of keysFor(email, ip)) failures.delete(key);
}

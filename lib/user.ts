/**
 * Derives a human-readable display name from a Supabase user object.
 * Follows the fallback chain:
 * 1. user_metadata.full_name
 * 2. user_metadata.name
 * 3. Email handle (split by '.', '_', '-', capitalized)
 * 4. Fallback: "User"
 */
export function getUserDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null | undefined): string {
  if (!user) return "User";
  const meta = user.user_metadata ?? {};
  const rawName = String(meta.full_name || meta.name || "").trim();
  const email = user.email ?? "";

  let displayName = rawName;
  if (!displayName && email) {
    const handle = email.split("@")[0] || "";
    displayName = handle
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  return displayName || "User";
}

/**
 * Derives 1-2 character uppercase initials from a display name.
 */
export function getUserInitials(displayName: string): string {
  const nameParts = displayName.trim().split(/\s+/);
  if (nameParts.length >= 2) {
    return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
  }
  if (nameParts[0] && nameParts[0].length >= 2) {
    return nameParts[0].slice(0, 2).toUpperCase();
  }
  if (nameParts[0] && nameParts[0].length === 1) {
    return nameParts[0].toUpperCase();
  }
  return "U";
}

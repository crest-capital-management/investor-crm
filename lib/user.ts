/**
 * Derives a human-readable display name from the signed-in user.
 * Follows the fallback chain:
 * 1. name
 * 2. Email handle (split by '.', '_', '-', capitalized)
 * 3. Fallback: "User"
 */
export function getUserDisplayName(user: {
  email?: string | null;
  name?: string | null;
} | null | undefined): string {
  if (!user) return "User";
  const rawName = (user.name ?? "").trim();
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

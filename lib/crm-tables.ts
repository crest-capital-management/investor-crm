/**
 * The CRM tables that backups save and restores replace. One list, so a new
 * table can't be added to backups but forgotten by restores (or the reverse).
 *
 * Order matters for restores: parents before children (inserts run in this
 * order, deletes in reverse). Logins (crm_users) are deliberately not here.
 */
export const CRM_TABLES: ReadonlyArray<{
  table: string;
  /** Shown to the user in restore messages. */
  label: string;
  /** Columns that give the backup a stable row order. */
  orderBy: string[];
  /** Tables added by later database changes; skipped when they don't exist. */
  optional?: boolean;
}> = [
  // Contact sections (azure/003_contact_sections.sql), before contacts which point at them.
  { table: "contact_sections", label: "Sections", orderBy: ["id"], optional: true },
  { table: "contacts", label: "Contacts", orderBy: ["id"] },
  { table: "groups", label: "Groups", orderBy: ["id"] },
  { table: "templates", label: "Templates", orderBy: ["id"] },
  { table: "contact_groups", label: "Group memberships", orderBy: ["contact_id", "group_id"] },
  { table: "interactions", label: "Meeting notes", orderBy: ["id"] },
  { table: "follow_ups", label: "Follow-ups", orderBy: ["id"] },
  { table: "broadcasts", label: "Broadcasts", orderBy: ["id"] },
  { table: "broadcast_recipients", label: "Broadcast recipients", orderBy: ["id"], optional: true },
  { table: "whatsapp_messages", label: "WhatsApp messages", orderBy: ["id"] },
  { table: "portfolio_updates", label: "Portfolio updates", orderBy: ["id"] },
  { table: "app_settings", label: "Settings", orderBy: ["id"], optional: true },
];

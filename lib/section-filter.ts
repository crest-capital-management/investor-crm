/**
 * Contact sections (shown as tabs, e.g. "Tab 1", "Tab 2"; renamed in the app): each contact belongs to at most one.
 * This file is safe to use in the browser; the database side is lib/sections.ts.
 */

export type ContactSection = { id: string; name: string };

/** A section with how many contacts it holds (on the page being shown). */
export type SectionWithCount = ContactSection & { count: number };

/** Sections plus the counts for "All" and "No section", or null before the database change is applied. */
export type SectionsInfo = {
  sections: SectionWithCount[];
  total: number;
  noSection: number;
};

/** Tab values: "all", "none" (contacts without a section) or a section id. */
export const ALL_SECTIONS = "all";
export const NO_SECTION = "none";

/** The tab to show for a ?section= value; unknown values fall back to "all". */
export function parseSectionParam(value: string | undefined, info: SectionsInfo | null): string {
  if (!info || !value) return ALL_SECTIONS;
  if (value === NO_SECTION) return NO_SECTION;
  return info.sections.some((section) => section.id === value) ? value : ALL_SECTIONS;
}

export function inSection(contact: { section_id?: string | null }, section: string): boolean {
  if (section === ALL_SECTIONS) return true;
  if (section === NO_SECTION) return !contact.section_id;
  return contact.section_id === section;
}

/** Adds the section condition to a SQL where clause (c = contacts alias). */
export function sectionCondition(section: string, params: unknown[]): string | null {
  if (section === ALL_SECTIONS) return null;
  if (section === NO_SECTION) return "c.section_id is null";
  params.push(section);
  return `c.section_id = $${params.length}::uuid`;
}

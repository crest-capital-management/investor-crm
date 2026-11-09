import { db } from "@/lib/db";
import type { ContactSection, SectionsInfo } from "@/lib/section-filter";
import { isUuid } from "@/lib/validate";

/**
 * The contact sections with their contact counts, in tab order. With
 * investorTags, the counts cover investors only (for the Investors page).
 */
export async function loadSectionsInfo(options: { investorTags?: string[] } = {}): Promise<SectionsInfo> {
  const params: unknown[] = [];
  let extra = "";
  if (options.investorTags) {
    params.push(options.investorTags);
    extra = " and c.tags && $1::text[]";
  }
  const [sections, totals] = await Promise.all([
    db.query<{ id: string; name: string; count: number }>(
      `select s.id, s.name, count(c.id)::int as count
         from public.contact_sections s
         left join public.contacts c on c.section_id = s.id and c.deleted_at is null${extra}
        group by s.id, s.name, s.sort_order
        order by s.sort_order, lower(s.name)`,
      params,
    ),
    db.one<{ total: number; none: number }>(
      `select count(*)::int as total, count(*) filter (where c.section_id is null)::int as none
         from public.contacts c where c.deleted_at is null${extra}`,
      params,
    ),
  ]);
  return { sections, total: totals.total, noSection: totals.none };
}

/**
 * Puts newly saved contacts into a section: the chosen one, or the first section
 * when none (or an unknown one) was chosen. Never fails the save it follows.
 */
export async function assignNewContactsToSection(contactIds: string[], sectionId: string | null | undefined): Promise<void> {
  if (contactIds.length === 0) return;
  try {
    await db.execute(
      `update public.contacts
          set section_id = coalesce(
                (select id from public.contact_sections where id = $2::uuid),
                (select id from public.contact_sections order by sort_order, lower(name) limit 1))
        where id = any($1::uuid[])`,
      [contactIds, sectionId && isUuid(sectionId) ? sectionId : null],
    );
  } catch (err) {
    console.error("[sections] could not assign a section:", err instanceof Error ? err.message : err);
  }
}

/** The section name of the active contact with this phone, if any (for duplicate messages). */
export async function sectionNameForPhone(phone: string): Promise<string | null> {
  try {
    const row = await db.maybeOne<{ name: string | null }>(
      `select s.name from public.contacts c
         left join public.contact_sections s on s.id = c.section_id
        where c.phone = $1 and c.deleted_at is null
        limit 1`,
      [phone],
    );
    return row?.name ?? null;
  } catch {
    return null;
  }
}

export type ContactSectionInfo = { sectionId: string | null; sections: ContactSection[] };

/** A contact's section and the list to choose from, or null if they could not be loaded. */
export async function loadContactSection(contactId: string): Promise<ContactSectionInfo | null> {
  try {
    const [row, sections] = await Promise.all([
      db.maybeOne<{ section_id: string | null }>("select section_id from public.contacts where id = $1", [contactId]),
      db.query<ContactSection>("select id, name from public.contact_sections order by sort_order, lower(name)"),
    ]);
    return { sectionId: row?.section_id ?? null, sections };
  } catch {
    return null;
  }
}

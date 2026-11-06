"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { ContactRow } from "@/components/contact-details-dialog";
import { ContactsTable } from "@/components/contacts-table";
import { ExportContactsMenu, type ExportOption } from "@/components/export-contacts-menu";
import { PaginationControls } from "@/components/pagination-controls";
import { SectionTabs } from "@/components/section-tabs";
import { ALL_SECTIONS, inSection, type SectionsInfo } from "@/lib/section-filter";
import { TagFilter } from "@/components/tag-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSearchIndex, searchContacts } from "@/lib/contact-search";
import { getPageRange, getTotalPages, PAGE_SIZE } from "@/lib/pagination";
import { useAllRows } from "@/lib/use-all-rows";

// Kept for the whole browser session, so coming back to Contacts is instant.
const contactsCache: { rows: ContactRow[] | null } = { rows: null };

/**
 * The Contacts list: search box, tag filter, table and paging. Once all
 * contacts are loaded, search/filter/paging run in the browser and update on
 * every keystroke; until then (or if loading fails) the server's page is shown.
 */
export function ContactsExplorer({
  sectionsInfo,
  initialSection,
  serverContacts,
  serverFilteredCount,
  unreadCounts,
  initialSearch,
  initialTags,
  initialPage,
}: {
  /** Null before the sections database change is applied (no tabs then). */
  sectionsInfo: SectionsInfo | null;
  initialSection: string;
  serverContacts: ContactRow[];
  serverFilteredCount: number;
  unreadCounts: Record<string, number>;
  initialSearch: string;
  initialTags: string[];
  initialPage: number;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [section, setSection] = useState(initialSection);
  const [page, setPage] = useState(initialPage);
  const deferredSearch = useDeferredValue(search);

  const allContacts = useAllRows<ContactRow>("/api/contacts/index", "contacts", contactsCache, serverContacts);
  const serverIndex = useMemo(() => buildSearchIndex(serverContacts), [serverContacts]);
  const fullIndex = useMemo(() => (allContacts ? buildSearchIndex(allContacts) : null), [allContacts]);
  const sectionIndex = useMemo(
    () => (fullIndex ? fullIndex.filter((entry) => inSection(entry.contact, section)) : null),
    [fullIndex, section],
  );

  const view = useMemo(() => {
    const trimmed = deferredSearch.trim();
    if (sectionIndex) {
      const matches = searchContacts(sectionIndex, trimmed, tags);
      const totalPages = getTotalPages(matches.length);
      const currentPage = Math.min(page, totalPages);
      const { from, to } = getPageRange(currentPage);
      return {
        rows: matches.slice(from, to + 1),
        total: matches.length,
        page: currentPage,
        matchingIds: matches.map((contact) => contact.id),
      };
    }
    // Not loaded yet: filter the page the server sent.
    const unchanged = !trimmed && tags.join(",") === initialTags.join(",") && section === initialSection;
    if (unchanged) return { rows: serverContacts, total: serverFilteredCount, page: initialPage, matchingIds: undefined };
    const matches = searchContacts(serverIndex, trimmed, tags).filter((contact) => inSection(contact, section));
    return { rows: matches, total: matches.length, page: 1, matchingIds: undefined };
  }, [deferredSearch, tags, section, page, sectionIndex, serverContacts, serverIndex, serverFilteredCount, initialPage, initialTags, initialSection]);

  // Export choices: the current section/search/filter results (when one is applied), or everything.
  const isFiltered = Boolean(deferredSearch.trim()) || tags.length > 0 || section !== ALL_SECTIONS;
  const exportOptions: ExportOption[] = [
    ...(isFiltered && view.matchingIds
      ? [
          { label: `Current results (${view.total.toLocaleString("en-IN")}) · Excel`, format: "xlsx" as const, ids: view.matchingIds, fileLabel: "filtered" as const },
          { label: `Current results (${view.total.toLocaleString("en-IN")}) · CSV`, format: "csv" as const, ids: view.matchingIds, fileLabel: "filtered" as const },
        ]
      : []),
    { label: "All contacts · Excel", format: "xlsx" as const },
    { label: "All contacts · CSV", format: "csv" as const },
  ];

  // Keep the address bar in step (so a refresh or shared link shows the same view) without a server round trip.
  useEffect(() => {
    const params = new URLSearchParams();
    if (section !== ALL_SECTIONS) params.set("section", section);
    if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
    if (tags.length > 0) params.set("tags", tags.join(","));
    if (view.page > 1) params.set("page", String(view.page));
    const query = params.toString();
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
  }, [deferredSearch, tags, section, view.page]);

  // The tab counts follow the loaded list (so they update right after a move), else the server's.
  const tabsInfo = useMemo(() => {
    if (!sectionsInfo || !allContacts) return sectionsInfo;
    const counts = new Map<string, number>();
    let none = 0;
    for (const contact of allContacts) {
      if (contact.section_id) counts.set(contact.section_id, (counts.get(contact.section_id) ?? 0) + 1);
      else none += 1;
    }
    return {
      sections: sectionsInfo.sections.map((s) => ({ ...s, count: counts.get(s.id) ?? 0 })),
      total: allContacts.length,
      noSection: none,
    };
  }, [sectionsInfo, allContacts]);

  function handleSectionChange(next: string) {
    setSection(next);
    setPage(1);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleTagsChange(next: string[]) {
    setTags(next);
    setPage(1);
  }

  return (
    <>
      {tabsInfo && <SectionTabs info={tabsInfo} value={section} onChange={handleSectionChange} />}
      <div className="mt-3 flex flex-wrap items-center gap-2.5 sm:gap-3">
        <div className="relative w-full max-w-md sm:w-80">
          <Input
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search by name, phone, or email..."
            aria-label="Search by name, phone, or email"
            className="h-10 pr-9"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => handleSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        <TagFilter selectedTags={tags} onTagsChange={handleTagsChange} />
        <ExportContactsMenu options={exportOptions} />
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <ContactsTable
          key={`${deferredSearch.trim()}-${tags.join(",")}-${section}-${view.page}`}
          sections={sectionsInfo?.sections}
          contacts={view.rows}
          matchingIds={view.matchingIds}
          totalMatching={view.total}
          unreadCounts={unreadCounts}
          search={deferredSearch.trim()}
        />
        <PaginationControls
          page={view.page}
          totalCount={view.total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </div>
    </>
  );
}

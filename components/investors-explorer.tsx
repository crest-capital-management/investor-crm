"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { InvestorTrackingTable, type InvestorTrackingRow } from "@/components/investor-tracking-table";
import { PaginationControls } from "@/components/pagination-controls";
import { SectionTabs } from "@/components/section-tabs";
import { ALL_SECTIONS, inSection, type SectionsInfo } from "@/lib/section-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSearchIndex, searchContacts } from "@/lib/contact-search";
import { getPageRange, getTotalPages, PAGE_SIZE } from "@/lib/pagination";
import { useAllRows } from "@/lib/use-all-rows";

// Kept for the whole browser session, so coming back to Investors is instant.
const investorsCache: { rows: InvestorTrackingRow[] | null } = { rows: null };

/**
 * The Investors list: search box, table and paging. Once all investors are
 * loaded, search and paging run in the browser and update on every keystroke;
 * until then (or if loading fails) the server's page is shown.
 */
export function InvestorsExplorer({
  sectionsInfo,
  initialSection,
  serverRows,
  serverTotal,
  unreadCounts,
  initialSearch,
  initialPage,
}: {
  /** Null before the sections database change is applied (no tabs then). */
  sectionsInfo: SectionsInfo | null;
  initialSection: string;
  serverRows: InvestorTrackingRow[];
  serverTotal: number;
  unreadCounts: Record<string, number>;
  initialSearch: string;
  initialPage: number;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [section, setSection] = useState(initialSection);
  const [page, setPage] = useState(initialPage);
  const deferredSearch = useDeferredValue(search);

  const allRows = useAllRows<InvestorTrackingRow>("/api/investors/index", "investors", investorsCache, serverRows);
  const serverIndex = useMemo(() => buildSearchIndex(serverRows), [serverRows]);
  const fullIndex = useMemo(() => (allRows ? buildSearchIndex(allRows) : null), [allRows]);
  const sectionIndex = useMemo(
    () => (fullIndex ? fullIndex.filter((entry) => inSection(entry.contact, section)) : null),
    [fullIndex, section],
  );

  const view = useMemo(() => {
    const trimmed = deferredSearch.trim();
    if (sectionIndex) {
      const matches = searchContacts(sectionIndex, trimmed, [], "name");
      const totalPages = getTotalPages(matches.length);
      const currentPage = Math.min(page, totalPages);
      const { from, to } = getPageRange(currentPage);
      return { rows: matches.slice(from, to + 1), total: matches.length, page: currentPage };
    }
    // Not loaded yet: filter the page the server sent.
    if (!trimmed && section === initialSection) return { rows: serverRows, total: serverTotal, page: initialPage };
    const matches = searchContacts(serverIndex, trimmed, [], "name").filter((row) => inSection(row, section));
    return { rows: matches, total: matches.length, page: 1 };
  }, [deferredSearch, section, page, sectionIndex, serverRows, serverIndex, serverTotal, initialPage, initialSection]);

  // Keep the address bar in step without a server round trip.
  useEffect(() => {
    const params = new URLSearchParams();
    if (section !== ALL_SECTIONS) params.set("section", section);
    if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
    if (view.page > 1) params.set("page", String(view.page));
    const query = params.toString();
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
  }, [deferredSearch, section, view.page]);

  // The tab counts follow the loaded list, else the server's.
  const tabsInfo = useMemo(() => {
    if (!sectionsInfo || !allRows) return sectionsInfo;
    const counts = new Map<string, number>();
    let none = 0;
    for (const row of allRows) {
      if (row.section_id) counts.set(row.section_id, (counts.get(row.section_id) ?? 0) + 1);
      else none += 1;
    }
    return {
      sections: sectionsInfo.sections.map((s) => ({ ...s, count: counts.get(s.id) ?? 0 })),
      total: allRows.length,
      noSection: none,
    };
  }, [sectionsInfo, allRows]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleSectionChange(next: string) {
    setSection(next);
    setPage(1);
  }

  return (
    <>
      {tabsInfo && <SectionTabs info={tabsInfo} value={section} onChange={handleSectionChange} />}
      <div className="relative mt-3 max-w-md">
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

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <InvestorTrackingTable investors={view.rows} unreadCounts={unreadCounts} />
        <PaginationControls
          page={view.page}
          totalCount={view.total}
          pageSize={PAGE_SIZE}
          itemLabel="investors"
          onPageChange={setPage}
        />
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { ManageSectionsDialog } from "@/components/manage-sections-dialog";
import { Button } from "@/components/ui/button";
import { ALL_SECTIONS, NO_SECTION, type SectionsInfo } from "@/lib/section-filter";

/** The row of section tabs (each section, "No section" when any, and "All") with a Manage button. */
export function SectionTabs({
  info,
  value,
  onChange,
}: {
  info: SectionsInfo;
  value: string;
  onChange: (value: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);

  const tabs = [
    ...info.sections.map((section) => ({ value: section.id, label: section.name, count: section.count })),
    ...(info.noSection > 0 || value === NO_SECTION ? [{ value: NO_SECTION, label: "No section", count: info.noSection }] : []),
    { value: ALL_SECTIONS, label: "All", count: info.total },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="ml-1.5 text-xs tabular-nums opacity-70">{tab.count.toLocaleString("en-IN")}</span>
            </button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setManageOpen(true)}>
        <Settings2 className="size-4" />
        Manage sections
      </Button>
      <ManageSectionsDialog open={manageOpen} onOpenChange={setManageOpen} sections={info.sections} />
    </div>
  );
}

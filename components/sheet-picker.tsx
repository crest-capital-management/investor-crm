"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Lets the user choose which sheet of an Excel workbook to read. Shown only when there are several. */
export function SheetPicker({
  sheetNames,
  value,
  onChange,
  disabled,
}: {
  sheetNames: string[];
  value: string;
  onChange: (sheet: string) => void;
  disabled?: boolean;
}) {
  if (sheetNames.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Sheet</span>
      <Select value={value} onValueChange={(next) => { if (next && next !== value) onChange(next); }} disabled={disabled}>
        <SelectTrigger className="h-9 w-56" aria-label="Sheet to use">
          <SelectValue>{(selected: string) => selected || "Select a sheet"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sheetNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">{sheetNames.length} sheets in this file</span>
    </div>
  );
}

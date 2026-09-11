"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";

export interface DateSavedPickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  label?: string;
  error?: string | null;
}

export function DateSavedPicker({
  value,
  onChange,
  label = "Date Saved to Phonebook",
  error,
}: DateSavedPickerProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:gap-2">
      {label && <Label>{label}</Label>}

      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="h-9 text-sm sm:h-10 w-full justify-start gap-2 font-normal"
            />
          }
        >
          <CalendarIcon className="size-4" />

          {value ? (
            value.toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          ) : (
            <span className="text-muted-foreground">Pick a date</span>
          )}
        </PopoverTrigger>

        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            disabled={{ after: new Date() }}
          />
        </PopoverContent>
      </Popover>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function toISODateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function parseISODate(dateStr?: string | null): Date | undefined {
  if (!dateStr) return undefined;
  const parts = dateStr.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return undefined;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

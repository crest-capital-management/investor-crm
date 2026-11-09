"use client";

import { useState } from "react";
import { startOfToday } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type Period = "AM" | "PM";

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

/** One hour from now, on the hour, as 12-hour clock parts. */
export function getDefaultFutureTime(): { hour: string; minute: string; period: Period } {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  let hours = now.getHours();
  const period: Period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return {
    hour: String(hours).padStart(2, "0"),
    minute: "00",
    period,
  };
}

/** The picked day at the picked 12-hour time, or undefined if anything is missing. */
export function combineDateAndTime(
  date: Date | undefined,
  hourStr: string,
  minuteStr: string,
  period: Period
): Date | undefined {
  if (!date) return undefined;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (isNaN(hour) || isNaN(minute)) return undefined;

  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }

  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

export function formatScheduledDisplay(date: Date | undefined): string {
  if (!date) return "";
  const datePart = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

/** Splits a saved scheduled time into picker parts (minutes rounded to the 5-minute steps). */
export function parseScheduledDateTime(dateStr: string | null | undefined): {
  date: Date;
  hour: string;
  minute: string;
  period: Period;
} | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  let hours = d.getHours();
  const period: Period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const minutes = d.getMinutes();
  const roundedMinutes = Math.min(55, Math.round(minutes / 5) * 5);
  const minuteStr = String(roundedMinutes).padStart(2, "0");
  const hourStr = String(hours).padStart(2, "0");

  return {
    date: d,
    hour: hourStr,
    minute: minuteStr,
    period,
  };
}

/**
 * Date and time for a scheduled broadcast: a calendar with hour, minute and
 * AM/PM controls in one popover. Controlled; `onEdit` runs after every change.
 */
export function SchedulePicker({
  date,
  onDateChange,
  hour,
  onHourChange,
  minute,
  onMinuteChange,
  period,
  onPeriodChange,
  scheduledDate,
  scheduleError,
  onEdit,
  disabled,
}: {
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  hour: string;
  onHourChange: (hour: string) => void;
  minute: string;
  onMinuteChange: (minute: string) => void;
  period: Period;
  onPeriodChange: (period: Period) => void;
  /** The combined date and time, or undefined while incomplete. */
  scheduledDate: Date | undefined;
  scheduleError: string | null;
  onEdit: () => void;
  disabled: boolean;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 max-w-sm">
      <Label htmlFor="schedule-popover-trigger" className="text-xs text-muted-foreground">
        Date & time
      </Label>

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger
          id="schedule-popover-trigger"
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="outline"
              className="h-9 text-sm sm:h-10 w-full justify-start gap-2 font-normal"
            />
          }
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          {scheduledDate ? (
            <span className="truncate">{formatScheduledDisplay(scheduledDate)}</span>
          ) : (
            <span className="text-muted-foreground">Pick date & time</span>
          )}
        </PopoverTrigger>

        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(next) => {
              onDateChange(next);
              onEdit();
            }}
            disabled={{ before: startOfToday() }}
          />

          {/* Styled Time Selection Control */}
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5 bg-muted/20">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="size-3.5" />
              <span>Time</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Hour Selector */}
              <Select
                value={hour}
                onValueChange={(val) => {
                  if (!val) return;
                  onHourChange(val);
                  onEdit();
                }}
              >
                <SelectTrigger className="h-8 w-[62px] text-xs font-medium" aria-label="Hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[62px]">
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-xs font-semibold text-muted-foreground">:</span>

              {/* Minute Selector */}
              <Select
                value={minute}
                onValueChange={(val) => {
                  if (!val) return;
                  onMinuteChange(val);
                  onEdit();
                }}
              >
                <SelectTrigger className="h-8 w-[62px] text-xs font-medium" aria-label="Minute">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[62px]">
                  {MINUTES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* AM/PM Toggle */}
              <div className="flex rounded-md border border-input bg-muted/60 p-0.5 text-xs">
                {(["AM", "PM"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      onPeriodChange(value);
                      onEdit();
                    }}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium transition-all cursor-pointer",
                      period === value
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick action bar in popover */}
          <div className="flex items-center justify-between border-t px-3 py-2 bg-muted/10 text-xs">
            <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">
              {scheduledDate ? formatScheduledDisplay(scheduledDate) : "Select a date above"}
            </span>
            <Button type="button" size="sm" className="h-6 px-2.5 text-xs" onClick={() => setCalendarOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {scheduleError && <p className="text-sm text-destructive">{scheduleError}</p>}
      {scheduledDate && !scheduleError && (
        scheduledDate.getTime() <= new Date().getTime() ? (
          <p className="text-sm text-destructive">Scheduled time must be in the future.</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Will be scheduled for:{" "}
            <span className="font-medium text-foreground">{formatScheduledDisplay(scheduledDate)}</span>
          </p>
        )
      )}
    </div>
  );
}

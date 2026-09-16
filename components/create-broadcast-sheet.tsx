"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { TAG_OPTIONS } from "@/components/add-contact-dialog";
import {
  createBroadcastDraft,
  createScheduledBroadcast,
  updateBroadcast,
  type TargetType,
} from "@/app/broadcasts/actions";
import { useToast } from "@/components/toast-provider";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, Clock, Search, Users } from "lucide-react";
import { startOfToday } from "date-fns";

export interface GroupOption {
  id: string;
  name: string;
}

export interface ContactOption {
  id: string;
  name: string;
  phone: string;
}

export interface BroadcastData {
  id: string;
  message_text: string;
  target_type: TargetType;
  target_ids: string[];
  status: "draft" | "scheduled" | "sent";
  created_at: string;
  scheduled_for?: string | null;
  sent_at?: string | null;
}

export interface CreateBroadcastSheetProps {
  groups: GroupOption[];
  contacts: ContactOption[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  editingBroadcast?: BroadcastData | null;
}

function getDefaultFutureTime(): {
  hour: string;
  minute: string;
  period: "AM" | "PM";
} {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  let hours = now.getHours();
  const period: "AM" | "PM" = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return {
    hour: String(hours).padStart(2, "0"),
    minute: "00",
    period,
  };
}

function combineDateAndTime(
  date: Date | undefined,
  hourStr: string,
  minuteStr: string,
  period: "AM" | "PM"
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

function formatScheduledDisplay(date: Date | undefined): string {
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

function parseScheduledDateTime(dateStr: string | null | undefined): {
  date: Date;
  hour: string;
  minute: string;
  period: "AM" | "PM";
} | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  let hours = d.getHours();
  const period: "AM" | "PM" = hours >= 12 ? "PM" : "AM";
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

export function CreateBroadcastSheet({
  groups = [],
  contacts = [],
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
  editingBroadcast,
}: CreateBroadcastSheetProps) {
  const router = useRouter();
  const { toast } = useToast();

  const isEditing = Boolean(editingBroadcast);
  const isEditingScheduled = editingBroadcast?.status === "scheduled";

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const [messageText, setMessageText] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("group");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");

  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<Date | undefined>(undefined);
  const [selectedHour, setSelectedHour] = useState<string>(() => getDefaultFutureTime().hour);
  const [selectedMinute, setSelectedMinute] = useState<string>(() => getDefaultFutureTime().minute);
  const [selectedPeriod, setSelectedPeriod] = useState<"AM" | "PM">(() => getDefaultFutureTime().period);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const scheduledDate = combineDateAndTime(
    selectedScheduleDate,
    selectedHour,
    selectedMinute,
    selectedPeriod
  );

  const [messageError, setMessageError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Adjust state when editingBroadcast changes (per React state adjustment pattern)
  const [prevEditingBroadcast, setPrevEditingBroadcast] = useState(editingBroadcast);
  if (editingBroadcast !== prevEditingBroadcast) {
    setPrevEditingBroadcast(editingBroadcast);
    if (editingBroadcast) {
      setMessageText(editingBroadcast.message_text ?? "");
      setTargetType(editingBroadcast.target_type ?? "group");
      if (editingBroadcast.target_type === "group") {
        setSelectedGroupIds(editingBroadcast.target_ids ?? []);
        setSelectedTags([]);
        setSelectedContactIds([]);
      } else if (editingBroadcast.target_type === "tag") {
        setSelectedTags(editingBroadcast.target_ids ?? []);
        setSelectedGroupIds([]);
        setSelectedContactIds([]);
      } else if (editingBroadcast.target_type === "manual") {
        setSelectedContactIds(editingBroadcast.target_ids ?? []);
        setSelectedGroupIds([]);
        setSelectedTags([]);
      }
      if (editingBroadcast.status === "scheduled") {
        setScheduleMode("later");
        const parsed = parseScheduledDateTime(editingBroadcast.scheduled_for);
        if (parsed) {
          setSelectedScheduleDate(parsed.date);
          setSelectedHour(parsed.hour);
          setSelectedMinute(parsed.minute);
          setSelectedPeriod(parsed.period);
        } else {
          setSelectedScheduleDate(undefined);
          const defTime = getDefaultFutureTime();
          setSelectedHour(defTime.hour);
          setSelectedMinute(defTime.minute);
          setSelectedPeriod(defTime.period);
        }
      } else {
        setScheduleMode("now");
        setSelectedScheduleDate(undefined);
        const defTime = getDefaultFutureTime();
        setSelectedHour(defTime.hour);
        setSelectedMinute(defTime.minute);
        setSelectedPeriod(defTime.period);
      }
      setCalendarOpen(false);
      setScheduleError(null);
      setMessageError(null);
      setTargetError(null);
      setError(null);
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (isControlled) {
      setControlledOpen?.(next);
    } else {
      setInternalOpen(next);
    }
    if (!next) {
      resetForm();
    }
  };

  // Group mode Select All logic
  const allGroupsSelected =
    groups.length > 0 && selectedGroupIds.length === groups.length;
  const someGroupsSelected =
    selectedGroupIds.length > 0 && !allGroupsSelected;
  const selectAllGroupsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllGroupsRef.current) {
      selectAllGroupsRef.current.indeterminate = someGroupsSelected;
    }
  }, [someGroupsSelected]);

  function toggleAllGroups() {
    if (allGroupsSelected) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(groups.map((g) => g.id));
    }
    setTargetError(null);
  }

  function handleGroupToggle(groupId: string) {
    setSelectedGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    );
    setTargetError(null);
  }

  // Tag mode Select All logic
  const allTagsSelected =
    TAG_OPTIONS.length > 0 && selectedTags.length === TAG_OPTIONS.length;
  const someTagsSelected = selectedTags.length > 0 && !allTagsSelected;
  const selectAllTagsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllTagsRef.current) {
      selectAllTagsRef.current.indeterminate = someTagsSelected;
    }
  }, [someTagsSelected]);

  function toggleAllTags() {
    if (allTagsSelected) {
      setSelectedTags([]);
    } else {
      setSelectedTags([...TAG_OPTIONS]);
    }
    setTargetError(null);
  }

  function handleTagToggle(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    );
    setTargetError(null);
  }

  // Manual mode contacts filter & Select All logic
  const filteredContacts = contacts.filter((c) => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.toLowerCase().includes(q))
    );
  });

  const visibleContactIds = filteredContacts.map((c) => c.id);
  const filteredSelectedCount = visibleContactIds.filter((id) =>
    selectedContactIds.includes(id)
  ).length;

  const allVisibleSelected =
    visibleContactIds.length > 0 &&
    filteredSelectedCount === visibleContactIds.length;
  const someVisibleSelected =
    filteredSelectedCount > 0 && !allVisibleSelected;
  const selectAllContactsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllContactsRef.current) {
      selectAllContactsRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  function toggleAllVisibleContacts() {
    if (allVisibleSelected) {
      setSelectedContactIds((prev) =>
        prev.filter((id) => !visibleContactIds.includes(id))
      );
    } else {
      setSelectedContactIds((prev) =>
        Array.from(new Set([...prev, ...visibleContactIds]))
      );
    }
    setTargetError(null);
  }

  function handleContactToggle(contactId: string) {
    setSelectedContactIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId]
    );
    setTargetError(null);
  }

  function resetForm() {
    if (editingBroadcast) {
      setMessageText(editingBroadcast.message_text ?? "");
      setTargetType(editingBroadcast.target_type ?? "group");
      if (editingBroadcast.target_type === "group") {
        setSelectedGroupIds(editingBroadcast.target_ids ?? []);
        setSelectedTags([]);
        setSelectedContactIds([]);
      } else if (editingBroadcast.target_type === "tag") {
        setSelectedTags(editingBroadcast.target_ids ?? []);
        setSelectedGroupIds([]);
        setSelectedContactIds([]);
      } else if (editingBroadcast.target_type === "manual") {
        setSelectedContactIds(editingBroadcast.target_ids ?? []);
        setSelectedGroupIds([]);
        setSelectedTags([]);
      }
      if (editingBroadcast.status === "scheduled") {
        setScheduleMode("later");
        const parsed = parseScheduledDateTime(editingBroadcast.scheduled_for);
        if (parsed) {
          setSelectedScheduleDate(parsed.date);
          setSelectedHour(parsed.hour);
          setSelectedMinute(parsed.minute);
          setSelectedPeriod(parsed.period);
        } else {
          setSelectedScheduleDate(undefined);
          const defTime = getDefaultFutureTime();
          setSelectedHour(defTime.hour);
          setSelectedMinute(defTime.minute);
          setSelectedPeriod(defTime.period);
        }
      } else {
        setScheduleMode("now");
        setSelectedScheduleDate(undefined);
        const defTime = getDefaultFutureTime();
        setSelectedHour(defTime.hour);
        setSelectedMinute(defTime.minute);
        setSelectedPeriod(defTime.period);
      }
    } else {
      setMessageText("");
      setTargetType("group");
      setSelectedGroupIds([]);
      setSelectedTags([]);
      setSelectedContactIds([]);
      setScheduleMode("now");
      setSelectedScheduleDate(undefined);
      const defTime = getDefaultFutureTime();
      setSelectedHour(defTime.hour);
      setSelectedMinute(defTime.minute);
      setSelectedPeriod(defTime.period);
    }
    setCalendarOpen(false);
    setScheduleError(null);
    setContactSearch("");
    setMessageError(null);
    setTargetError(null);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessageError(null);
    setTargetError(null);
    setScheduleError(null);
    setError(null);

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage) {
      setMessageError("Message text is required.");
      return;
    }

    let targetIds: string[] = [];
    if (targetType === "group") {
      if (selectedGroupIds.length === 0) {
        setTargetError("Please select at least one group.");
        return;
      }
      targetIds = selectedGroupIds;
    } else if (targetType === "tag") {
      if (selectedTags.length === 0) {
        setTargetError("Please select at least one tag.");
        return;
      }
      targetIds = selectedTags;
    } else if (targetType === "manual") {
      if (selectedContactIds.length === 0) {
        setTargetError("Please select at least one contact.");
        return;
      }
      targetIds = selectedContactIds;
    }

    if ((!isEditing && scheduleMode === "later") || isEditingScheduled) {
      if (!selectedScheduleDate) {
        setScheduleError("Scheduled date and time is required.");
        return;
      }
      if (!scheduledDate || isNaN(scheduledDate.getTime())) {
        setScheduleError("Please select a valid scheduled date and time.");
        return;
      }
      if (scheduledDate.getTime() <= new Date().getTime()) {
        setScheduleError("Scheduled time must be in the future.");
        return;
      }
    }

    setSubmitting(true);
    let result: { success?: boolean; error?: string };

    if (isEditing && editingBroadcast) {
      result = await updateBroadcast(editingBroadcast.id, {
        message_text: trimmedMessage,
        target_type: targetType,
        target_ids: targetIds,
        ...(isEditingScheduled && scheduledDate
          ? { scheduled_for: scheduledDate.toISOString() }
          : {}),
      });
    } else if (scheduleMode === "later") {
      if (!scheduledDate) {
        setScheduleError("Scheduled date and time is required.");
        setSubmitting(false);
        return;
      }
      result = await createScheduledBroadcast({
        message_text: trimmedMessage,
        target_type: targetType,
        target_ids: targetIds,
        scheduled_for: scheduledDate.toISOString(),
      });
    } else {
      result = await createBroadcastDraft({
        message_text: trimmedMessage,
        target_type: targetType,
        target_ids: targetIds,
      });
    }

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      toast(result.error, "error");
      return;
    }

    toast(
      isEditingScheduled
        ? "Scheduled broadcast updated successfully"
        : isEditing
        ? "Broadcast updated successfully"
        : scheduleMode === "later"
        ? "Broadcast scheduled successfully"
        : "Broadcast draft saved successfully"
    );
    resetForm();
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {trigger !== undefined ? (
        trigger
      ) : isEditing ? null : (
        <SheetTrigger
          render={
            <Button className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm" />
          }
        >
          + New Broadcast
        </SheetTrigger>
      )}

      <SheetContent side="right" className="flex flex-col gap-0">
        <SheetHeader className="border-b px-4 py-3.5 sm:px-6 sm:py-5">
          <SheetTitle className="text-lg sm:text-xl">
            {isEditing
              ? isEditingScheduled
                ? "Edit Scheduled Broadcast"
                : "Edit Broadcast"
              : "New Broadcast"}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {isEditing
              ? isEditingScheduled
                ? "Modify your scheduled broadcast message, recipient targets, and send time."
                : "Modify your draft broadcast message and recipient targets."
              : "Compose a broadcast message and select recipient targets."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
            {/* Message Text Field */}
            <div className="flex flex-col gap-1.5 sm:gap-2">
              <Label htmlFor="broadcast-message">Message text</Label>
              <Textarea
                id="broadcast-message"
                placeholder="Type your broadcast message here..."
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  if (messageError) setMessageError(null);
                }}
                rows={4}
                className="resize-y"
              />
              {messageError && (
                <p className="text-sm text-destructive">{messageError}</p>
              )}
            </div>

            {/* Targeting Options */}
            <div className="flex flex-col gap-2">
              <Label>Targeting mode</Label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs sm:text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setTargetType("group");
                    setTargetError(null);
                  }}
                  className={cn(
                    "cursor-pointer rounded-md py-1.5 font-medium transition-all",
                    targetType === "group"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Group
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetType("tag");
                    setTargetError(null);
                  }}
                  className={cn(
                    "cursor-pointer rounded-md py-1.5 font-medium transition-all",
                    targetType === "tag"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Tag
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetType("manual");
                    setTargetError(null);
                  }}
                  className={cn(
                    "cursor-pointer rounded-md py-1.5 font-medium transition-all",
                    targetType === "manual"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Manual
                </button>
              </div>

              {/* Group Mode */}
              {targetType === "group" && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                      <input
                        ref={selectAllGroupsRef}
                        type="checkbox"
                        checked={allGroupsSelected}
                        onChange={toggleAllGroups}
                        disabled={groups.length === 0}
                        aria-label="Select all groups"
                        className="size-4 cursor-pointer accent-primary rounded disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>Select All</span>
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {selectedGroupIds.length} of {groups.length} selected
                    </span>
                  </div>
                  <div className="h-52 overflow-y-auto divide-y rounded-md border p-1">
                    {groups.length > 0 ? (
                      groups.map((group) => {
                        const isSelected = selectedGroupIds.includes(group.id);
                        return (
                          <label
                            key={group.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted/60 select-none transition-colors"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleGroupToggle(group.id)}
                            />
                            <span className="truncate text-sm font-medium">
                              {group.name}
                            </span>
                          </label>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No groups available. Please create a group first in Groups.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tag Mode */}
              {targetType === "tag" && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                      <input
                        ref={selectAllTagsRef}
                        type="checkbox"
                        checked={allTagsSelected}
                        onChange={toggleAllTags}
                        aria-label="Select all tags"
                        className="size-4 cursor-pointer accent-primary rounded"
                      />
                      <span>Select All</span>
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {selectedTags.length} of {TAG_OPTIONS.length} selected
                    </span>
                  </div>
                  <div className="h-52 overflow-y-auto divide-y rounded-md border p-1">
                    {TAG_OPTIONS.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <label
                          key={tag}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted/60 select-none transition-colors"
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleTagToggle(tag)}
                          />
                          <span className="text-sm font-medium">{tag}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Manual Mode */}
              {targetType === "manual" && (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      placeholder="Search contacts by name or phone..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="h-9 pl-8 text-sm"
                    />
                  </div>

                  <div className="flex items-center justify-between px-0.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                      <input
                        ref={selectAllContactsRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisibleContacts}
                        disabled={visibleContactIds.length === 0}
                        aria-label="Select all matching contacts"
                        className="size-4 cursor-pointer accent-primary rounded disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>
                        Select All
                        {contactSearch.trim() ? ` (${filteredContacts.length} matching)` : ""}
                      </span>
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {selectedContactIds.length} of {contacts.length} selected
                      {contactSearch.trim() && ` (${filteredSelectedCount} in search)`}
                    </span>
                  </div>

                  <div className="h-52 overflow-y-auto divide-y rounded-md border">
                    {filteredContacts.length > 0 ? (
                      filteredContacts.map((contact) => {
                        const isSelected = selectedContactIds.includes(contact.id);
                        return (
                          <label
                            key={contact.id}
                            className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 select-none"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleContactToggle(contact.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-sm">
                                {contact.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {contact.phone}
                              </p>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        {contactSearch
                          ? "No matching contacts found."
                          : "No contacts available."}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {targetError && (
                <p className="text-sm text-destructive">{targetError}</p>
              )}
            </div>

            {/* Recipient & Audience Summary Card */}
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <Users className="size-3.5 text-muted-foreground" />
                  Target Audience
                </span>
                <span className="font-medium text-muted-foreground">
                  {targetType === "group"
                    ? `${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? "" : "s"} selected`
                    : targetType === "tag"
                    ? `${selectedTags.length} tag${selectedTags.length === 1 ? "" : "s"} selected`
                    : `${selectedContactIds.length} contact${selectedContactIds.length === 1 ? "" : "s"} selected`}
                </span>
              </div>

              <p className="mt-1.5 text-muted-foreground leading-relaxed">
                {targetType === "group" && (
                  selectedGroupIds.length > 0 ? (
                    `Will broadcast to contacts in: ${groups
                      .filter((g) => selectedGroupIds.includes(g.id))
                      .map((g) => g.name)
                      .join(", ")}`
                  ) : (
                    "Select one or more groups from the list above."
                  )
                )}
                {targetType === "tag" && (
                  selectedTags.length > 0 ? (
                    `Will broadcast to contacts tagged: ${selectedTags.join(", ")}`
                  ) : (
                    "Select one or more tags from the list above."
                  )
                )}
                {targetType === "manual" && (
                  selectedContactIds.length > 0 ? (
                    `Will broadcast directly to ${selectedContactIds.length} selected contact${selectedContactIds.length === 1 ? "" : "s"}.`
                  ) : (
                    "Select one or more contacts from the list above."
                  )
                )}
              </p>
            </div>

            {/* Scheduling Options */}
            {(!isEditing || isEditingScheduled) && (
              <div className="flex flex-col gap-2">
                <Label>Scheduling</Label>
                {!isEditing && (
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs sm:text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleMode("now");
                        setScheduleError(null);
                      }}
                      className={cn(
                        "cursor-pointer rounded-md py-1.5 font-medium transition-all",
                        scheduleMode === "now"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Send Now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleMode("later");
                        setScheduleError(null);
                      }}
                      className={cn(
                        "cursor-pointer rounded-md py-1.5 font-medium transition-all",
                        scheduleMode === "later"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Schedule for later
                    </button>
                  </div>
                )}

                {(scheduleMode === "later" || isEditingScheduled) && (
                  <div className={cn("flex flex-col gap-1.5", !isEditing && "mt-1")}>
                    <Label
                      htmlFor="schedule-popover-trigger"
                      className="text-xs text-muted-foreground"
                    >
                      Date & time
                    </Label>

                    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                      <PopoverTrigger
                        id="schedule-popover-trigger"
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
                          <span className="truncate">
                            {formatScheduledDisplay(scheduledDate)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Pick date & time</span>
                        )}
                      </PopoverTrigger>

                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedScheduleDate}
                          onSelect={(date) => {
                            setSelectedScheduleDate(date);
                            if (scheduleError) setScheduleError(null);
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
                            <select
                              value={selectedHour}
                              onChange={(e) => {
                                setSelectedHour(e.target.value);
                                if (scheduleError) setScheduleError(null);
                              }}
                              aria-label="Hour"
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium shadow-xs focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring outline-none cursor-pointer"
                            >
                              {Array.from({ length: 12 }, (_, i) => {
                                const h = String(i + 1).padStart(2, "0");
                                return (
                                  <option key={h} value={h}>
                                    {h}
                                  </option>
                                );
                              })}
                            </select>

                            <span className="text-xs font-semibold text-muted-foreground">:</span>

                            {/* Minute Selector */}
                            <select
                              value={selectedMinute}
                              onChange={(e) => {
                                setSelectedMinute(e.target.value);
                                if (scheduleError) setScheduleError(null);
                              }}
                              aria-label="Minute"
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium shadow-xs focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring outline-none cursor-pointer"
                            >
                              {[
                                "00",
                                "05",
                                "10",
                                "15",
                                "20",
                                "25",
                                "30",
                                "35",
                                "40",
                                "45",
                                "50",
                                "55",
                              ].map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>

                            {/* AM/PM Toggle */}
                            <div className="flex rounded-md border border-input bg-muted/60 p-0.5 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPeriod("AM");
                                  if (scheduleError) setScheduleError(null);
                                }}
                                className={cn(
                                  "rounded px-2 py-0.5 text-xs font-medium transition-all cursor-pointer",
                                  selectedPeriod === "AM"
                                    ? "bg-background text-foreground shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPeriod("PM");
                                  if (scheduleError) setScheduleError(null);
                                }}
                                className={cn(
                                  "rounded px-2 py-0.5 text-xs font-medium transition-all cursor-pointer",
                                  selectedPeriod === "PM"
                                    ? "bg-background text-foreground shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                PM
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Quick action bar in popover */}
                        <div className="flex items-center justify-between border-t px-3 py-2 bg-muted/10 text-xs">
                          <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                            {scheduledDate
                              ? formatScheduledDisplay(scheduledDate)
                              : "Select a date above"}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 px-2.5 text-xs"
                            onClick={() => setCalendarOpen(false)}
                          >
                            Done
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {scheduleError && (
                      <p className="text-sm text-destructive">{scheduleError}</p>
                    )}
                    {scheduledDate && !scheduleError && (
                      scheduledDate.getTime() <= new Date().getTime() ? (
                        <p className="text-sm text-destructive">
                          Scheduled time must be in the future.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Will be scheduled for:{" "}
                          <span className="font-medium text-foreground">
                            {formatScheduledDisplay(scheduledDate)}
                          </span>
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <SheetFooter className="border-t bg-muted/20 px-4 py-3 sm:px-6 sm:py-4 gap-2 sm:flex-row sm:justify-end">
            <SheetClose
              render={
                <Button
                  variant="outline"
                  type="button"
                  className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm"
                />
              }
            >
              Cancel
            </SheetClose>
            <Button
              type="submit"
              disabled={submitting}
              className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm"
            >
              {submitting
                ? scheduleMode === "later" && !isEditing
                  ? "Scheduling..."
                  : "Saving..."
                : isEditing
                ? "Save Changes"
                : scheduleMode === "later"
                ? "Schedule Broadcast"
                : "Save Draft"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

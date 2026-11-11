"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Users, X } from "lucide-react";

import type { ContactOption, GroupOption, TargetType } from "@/app/broadcasts/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TAG_OPTIONS } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { ALL_SECTIONS, NO_SECTION, inSection, type ContactSection } from "@/lib/section-filter";

/** A "Select All" checkbox that shows a dash when only some items are selected. */
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  ariaLabel,
  children,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className="size-4 cursor-pointer accent-primary rounded disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span>{children}</span>
    </label>
  );
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const TARGET_MODES: Array<{ value: TargetType; label: string }> = [
  { value: "group", label: "Group" },
  { value: "tag", label: "Tag" },
  { value: "manual", label: "Manual" },
];

/**
 * Who a broadcast goes to: whole groups, everyone with a tag, or hand-picked
 * contacts, with a summary of the selection. Controlled: the editor owns the
 * selection (it validates it on save); `onEdit` runs after every change.
 */
export function AudiencePicker({
  targetType,
  onTargetTypeChange,
  groups,
  selectedGroupIds,
  onSelectedGroupIdsChange,
  selectedTags,
  onSelectedTagsChange,
  contacts,
  sections = [],
  selectedContactIds,
  onSelectedContactIdsChange,
  targetError,
  onEdit,
  isReadOnly,
}: {
  targetType: TargetType;
  onTargetTypeChange: (type: TargetType) => void;
  groups: GroupOption[];
  selectedGroupIds: string[];
  onSelectedGroupIdsChange: (update: (current: string[]) => string[]) => void;
  selectedTags: string[];
  onSelectedTagsChange: (update: (current: string[]) => string[]) => void;
  contacts: ContactOption[];
  sections?: ContactSection[];
  selectedContactIds: string[];
  onSelectedContactIdsChange: (update: (current: string[]) => string[]) => void;
  targetError: string | null;
  onEdit: () => void;
  isReadOnly: boolean;
}) {
  const [contactSearch, setContactSearch] = useState("");
  // Narrow the contact list to one section (e.g. one team member's contacts).
  const [sectionFilter, setSectionFilter] = useState(ALL_SECTIONS);

  // Groups
  const allGroupsSelected = groups.length > 0 && selectedGroupIds.length === groups.length;
  const someGroupsSelected = selectedGroupIds.length > 0 && !allGroupsSelected;

  function toggleAllGroups() {
    if (isReadOnly) return;
    onSelectedGroupIdsChange(() => (allGroupsSelected ? [] : groups.map((g) => g.id)));
    onEdit();
  }

  function handleGroupToggle(groupId: string) {
    if (isReadOnly) return;
    onSelectedGroupIdsChange((current) => toggle(current, groupId));
    onEdit();
  }

  // Tags
  const allTagsSelected = TAG_OPTIONS.length > 0 && selectedTags.length === TAG_OPTIONS.length;
  const someTagsSelected = selectedTags.length > 0 && !allTagsSelected;

  function toggleAllTags() {
    if (isReadOnly) return;
    onSelectedTagsChange(() => (allTagsSelected ? [] : [...TAG_OPTIONS]));
    onEdit();
  }

  function handleTagToggle(tag: string) {
    if (isReadOnly) return;
    onSelectedTagsChange((current) => toggle(current, tag));
    onEdit();
  }

  // Manual: "Select All" applies to the contacts matching the search.
  const filteredContacts = contacts.filter((c) => {
    if (!inSection(c, sectionFilter)) return false;
    const q = contactSearch.toLowerCase().trim();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.phone && c.phone.toLowerCase().includes(q));
  });
  const visibleContactIds = filteredContacts.map((c) => c.id);
  const filteredSelectedCount = visibleContactIds.filter((id) => selectedContactIds.includes(id)).length;
  const allVisibleSelected = visibleContactIds.length > 0 && filteredSelectedCount === visibleContactIds.length;
  const someVisibleSelected = filteredSelectedCount > 0 && !allVisibleSelected;

  function toggleAllVisibleContacts() {
    if (isReadOnly) return;
    if (allVisibleSelected) {
      onSelectedContactIdsChange((prev) => prev.filter((id) => !visibleContactIds.includes(id)));
    } else {
      onSelectedContactIdsChange((prev) => Array.from(new Set([...prev, ...visibleContactIds])));
    }
    onEdit();
  }

  function handleContactToggle(contactId: string) {
    if (isReadOnly) return;
    onSelectedContactIdsChange((current) => toggle(current, contactId));
    onEdit();
  }

  return (
    <section className="rounded-lg border bg-background p-5">
      <h2 className="text-base font-semibold">Target Audience</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose whether to broadcast to a specific group, tag, or select individual contacts.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Label>Targeting mode</Label>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs sm:text-sm max-w-md">
          {TARGET_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              disabled={isReadOnly}
              onClick={() => {
                onTargetTypeChange(mode.value);
                onEdit();
              }}
              className={cn(
                "cursor-pointer rounded-md py-1.5 font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60",
                targetType === mode.value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Group Mode */}
        {targetType === "group" && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center justify-between px-0.5">
              <SelectAllCheckbox
                checked={allGroupsSelected}
                indeterminate={someGroupsSelected}
                onChange={toggleAllGroups}
                disabled={isReadOnly || groups.length === 0}
                ariaLabel="Select all groups"
              >
                Select All
              </SelectAllCheckbox>
              <span className="text-xs text-muted-foreground">
                {selectedGroupIds.length} of {groups.length} selected
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y rounded-md border p-1">
              {groups.length > 0 ? (
                groups.map((group) => {
                  const isSelected = selectedGroupIds.includes(group.id);
                  return (
                    <label
                      key={group.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted/60 select-none transition-colors",
                        isReadOnly && "cursor-default hover:bg-transparent"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        disabled={isReadOnly}
                        onCheckedChange={() => handleGroupToggle(group.id)}
                      />
                      <span className="truncate text-sm font-medium">{group.name}</span>
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
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center justify-between px-0.5">
              <SelectAllCheckbox
                checked={allTagsSelected}
                indeterminate={someTagsSelected}
                onChange={toggleAllTags}
                disabled={isReadOnly}
                ariaLabel="Select all tags"
              >
                Select All
              </SelectAllCheckbox>
              <span className="text-xs text-muted-foreground">
                {selectedTags.length} of {TAG_OPTIONS.length} selected
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y rounded-md border p-1">
              {TAG_OPTIONS.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <label
                    key={tag}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted/60 select-none transition-colors",
                      isReadOnly && "cursor-default hover:bg-transparent"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={isReadOnly}
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
            {sections.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter contacts by section">
                {[{ id: ALL_SECTIONS, name: "All" }, ...sections, { id: NO_SECTION, name: "No section" }].map((option) => {
                  const count = contacts.filter((c) => inSection(c, option.id)).length;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSectionFilter(option.id)}
                      className={cn(
                        "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        sectionFilter === option.id
                          ? "border-foreground bg-foreground text-background"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.name} ({count})
                    </button>
                  );
                })}
              </div>
            )}
            <div className="relative max-w-md">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts by name or phone..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>

            <div className="flex items-center justify-between px-0.5">
              <SelectAllCheckbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                onChange={toggleAllVisibleContacts}
                disabled={isReadOnly || visibleContactIds.length === 0}
                ariaLabel="Select all matching contacts"
              >
                Select All
                {contactSearch.trim() || sectionFilter !== ALL_SECTIONS ? ` (${filteredContacts.length} shown)` : ""}
              </SelectAllCheckbox>
              <span className="text-xs text-muted-foreground">
                {selectedContactIds.length} of {contacts.length} selected
                {contactSearch.trim() && ` (${filteredSelectedCount} in search)`}
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y rounded-md border">
              {filteredContacts.length > 0 ? (
                filteredContacts.map((contact) => {
                  const isSelected = selectedContactIds.includes(contact.id);
                  return (
                    <label
                      key={contact.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 select-none",
                        isReadOnly && "cursor-default hover:bg-transparent"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        disabled={isReadOnly}
                        onCheckedChange={() => handleContactToggle(contact.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">{contact.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{contact.phone}</p>
                      </div>
                    </label>
                  );
                })
              ) : (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {contactSearch || sectionFilter !== ALL_SECTIONS ? "No matching contacts found." : "No contacts available."}
                </div>
              )}
            </div>
          </div>
        )}

        {targetError && <p className="text-sm text-destructive">{targetError}</p>}

        {/* Recipient & Audience Summary Card */}
        <div className="mt-2 rounded-lg border bg-muted/40 p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <Users className="size-3.5 text-muted-foreground" />
              Target Audience Summary
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
            {targetType === "group" &&
              (selectedGroupIds.length > 0
                ? `Will broadcast to contacts in: ${groups
                    .filter((g) => selectedGroupIds.includes(g.id))
                    .map((g) => g.name)
                    .join(", ")}`
                : "Select one or more groups from the list above.")}
            {targetType === "tag" &&
              (selectedTags.length > 0
                ? `Will broadcast to contacts tagged: ${selectedTags.join(", ")}`
                : "Select one or more tags from the list above.")}
            {targetType === "manual" &&
              (selectedContactIds.length > 0
                ? `Will broadcast directly to ${selectedContactIds.length} selected contact${selectedContactIds.length === 1 ? "" : "s"}.`
                : "Select one or more contacts from the list above.")}
          </p>

          {targetType === "manual" && selectedContactIds.length > 0 && (
            <ul className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" aria-label="Selected contacts">
              {contacts
                .filter((contact) => selectedContactIds.includes(contact.id))
                .map((contact) => (
                  <li
                    key={contact.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background py-1 pl-2.5 pr-1.5 text-xs"
                  >
                    <span className="truncate font-medium text-foreground">{contact.name}</span>
                    <span className="shrink-0 text-muted-foreground">{contact.phone}</span>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleContactToggle(contact.id)}
                        aria-label={`Remove ${contact.name}`}
                        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

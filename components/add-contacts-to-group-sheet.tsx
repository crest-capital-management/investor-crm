"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  addContactsToGroup,
  getGroupContactOptions,
  type GroupContactOption,
} from "@/app/groups/actions";
import type { GroupRow } from "@/components/group-details-dialog";
import { useToast } from "@/components/toast-provider";
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
import { Input } from "@/components/ui/input";

export function AddContactsToGroupSheet({
  groupId,
  onAdded,
}: {
  groupId: string;
  onAdded: (contactGroups: GroupRow["contact_groups"]) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<GroupContactOption[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const visibleContactIds = contacts.map((contact) => contact.id);
  const selectedVisibleCount = visibleContactIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleContactIds.length > 0 && selectedVisibleCount === visibleContactIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const result = await getGroupContactOptions(groupId, search);
      if (cancelled) return;

      setLoading(false);
      if (result.error) {
        setError(result.error);
        setContacts([]);
        return;
      }

      setContacts(result.contacts ?? []);
      setTotalContacts(result.totalContacts ?? 0);
    }, search ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [groupId, open, search]);

  function reset() {
    setSearch("");
    setContacts([]);
    setTotalContacts(0);
    setSelectedIds(new Set());
    setError(null);
    setLoading(false);
  }

  function toggleContact(contactId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function toggleVisibleContacts() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleContactIds.forEach((id) => next.delete(id));
      else visibleContactIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIds.size) return;

    setSubmitting(true);
    const result = await addContactsToGroup(groupId, [...selectedIds]);
    setSubmitting(false);

    if (result.error) {
      toast("Failed to add contacts to group", "error");
      return;
    }

    onAdded(result.contactGroups as GroupRow["contact_groups"]);
    setOpen(false);
    reset();
    router.refresh();
    toast(
      result.added
        ? `${result.added} contact${result.added === 1 ? "" : "s"} added to group`
        : "No new contacts were added",
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-8 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        + Add Contacts
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col gap-0">
        <SheetHeader className="border-b px-4 py-3.5 sm:px-6 sm:py-5">
          <SheetTitle className="text-lg sm:text-xl">Add Contacts</SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">Add existing contacts to this group.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-6">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search contacts..."
              aria-label="Search contacts"
              className="h-9 text-sm sm:h-10"
            />
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              {loading ? (
                <p className="px-4 py-8 text-center text-xs sm:text-sm text-muted-foreground">Loading contacts...</p>
              ) : error ? (
                <p className="px-4 py-8 text-center text-xs sm:text-sm text-destructive">{error}</p>
              ) : contacts.length ? (
                <div className="divide-y">
                  <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs sm:py-2.5 sm:text-sm text-muted-foreground">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleContacts}
                      aria-label="Select visible contacts"
                      className="size-4 cursor-pointer accent-primary"
                    />
                    <span>Select visible contacts</span>
                  </label>
                  {contacts.map((contact) => (
                    <label key={contact.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 sm:py-3 hover:bg-muted/20">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        className="size-4 cursor-pointer accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{contact.name}</span>
                        <span className="mt-0.5 block text-xs sm:text-sm text-muted-foreground">{contact.phone}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-xs sm:text-sm text-muted-foreground">
                  {search ? "No contacts found." : totalContacts ? "All contacts are already in this group." : "No contacts available."}
                </p>
              )}
            </div>
            <p className="text-xs sm:text-sm font-medium text-muted-foreground">
              {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"} selected
            </p>
          </div>
          <SheetFooter className="border-t bg-muted/20 px-4 py-3 sm:px-6 sm:py-4 gap-2 sm:flex-row sm:justify-end">
            <SheetClose render={<Button variant="outline" type="button" className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm" />}>Cancel</SheetClose>
            <Button type="submit" disabled={!selectedIds.size || submitting || loading} className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm">
              {submitting ? "Adding..." : "Add Contacts"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import {
  addContactToGroups,
  addTagToContact,
  deleteContact,
  getContactGroupOptions,
  updateContact,
} from "@/app/contacts/actions";
import { TAG_OPTIONS } from "@/components/add-contact-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { CalendarIcon, Copy, Plus, Trash2 } from "lucide-react";

export type ContactRow = {
  id: string;
  name: string;
  phone: string;
  tags: string[] | null;
  date_saved: string;
  contact_groups:
    | Array<{
        groups:
          | { id: string; name: string }
          | Array<{ id: string; name: string }>;
      }>
    | null;
};

type ContactDetailsDialogProps = {
  contact: ContactRow;
  children: ReactElement;
};

export function ContactDetailsDialog({
  contact,
  children,
}: ContactDetailsDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentContact, setCurrentContact] = useState(contact);
  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone);
  const [tag, setTag] = useState(contact.tags?.[0] ?? "");
  const [dateSaved, setDateSaved] = useState(contact.date_saved.slice(0, 10));
  const [addingTag, setAddingTag] = useState(false);
  const [selectedTagToAdd, setSelectedTagToAdd] = useState("");
  const [addingGroups, setAddingGroups] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [savingGroups, setSavingGroups] = useState(false);

  function loadContact() {
    setCurrentContact(contact);
    setName(contact.name);
    setPhone(contact.phone);
    setTag(contact.tags?.[0] ?? "");
    setDateSaved(contact.date_saved.slice(0, 10));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setEditing(false);
      setConfirmingDelete(false);
      setError(null);
      loadContact();
    }
  }

  function beginEdit() {
    setError(null);
    setEditing(true);
  }

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(currentContact.phone);
      toast("Phone number copied");
    } catch {
      toast("Could not copy phone number", "error");
    }
  }

  async function handleAddTag() {
    if (!selectedTagToAdd) return;
    setAddingTag(true);
    const result = await addTagToContact(currentContact.id, selectedTagToAdd);
    setAddingTag(false);
    if (result.error) {
      toast(result.error, "error");
      return;
    }
    setCurrentContact((existing) => ({ ...existing, tags: result.tags ?? existing.tags }));
    setSelectedTagToAdd("");
    setAddingTag(false);
    toast("Tag added successfully");
  }

  async function openAddGroups() {
    setAddingGroups(true);
    setLoadingGroups(true);
    const result = await getContactGroupOptions(currentContact.id);
    setLoadingGroups(false);
    if (result.error) {
      toast(result.error, "error");
      return;
    }
    setAvailableGroups(result.groups ?? []);
  }

  function toggleGroupSelection(groupId: string) {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function handleAddGroups() {
    if (!selectedGroupIds.size) return;
    setSavingGroups(true);
    const result = await addContactToGroups(currentContact.id, [...selectedGroupIds]);
    setSavingGroups(false);
    if (result.error) {
      toast(result.error, "error");
      return;
    }
    setCurrentContact((existing) => ({ ...existing, contact_groups: result.groups ?? existing.contact_groups }));
    setSelectedGroupIds(new Set());
    setAddingGroups(false);
    router.refresh();
    toast(result.added === 1 ? "Added to group" : `${result.added} groups added`);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (!/^\d{7,15}$/.test(trimmedPhone)) {
      setError("Enter a valid phone number (7-15 digits).");
      return;
    }
    if (!dateSaved) {
      setError("Date is required.");
      return;
    }

    const formData = new FormData();
    formData.set("name", trimmedName);
    formData.set("phone", trimmedPhone);
    formData.set("tags", JSON.stringify(tag.trim() ? [tag.trim()] : []));
    formData.set("dateSaved", dateSaved);

    setSaving(true);
    const result = await updateContact(currentContact.id, formData);
    setSaving(false);

    if (result.error) {
      toast("Failed to update contact", "error");
      return;
    }

    setCurrentContact({
      ...currentContact,
      name: trimmedName,
      phone: trimmedPhone,
      tags: tag.trim() ? [tag.trim()] : [],
      date_saved: dateSaved,
    });
    setEditing(false);
    router.refresh();
    toast("Contact updated successfully");
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    const result = await deleteContact(currentContact.id);
    setDeleting(false);

    if (result.error) {
      toast("Failed to delete contact", "error");
      setConfirmingDelete(false);
      return;
    }

    setConfirmingDelete(false);
    setOpen(false);
    router.refresh();
    toast("Contact deleted successfully");
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger nativeButton={false} render={children} />
        <SheetContent side="right" className="flex flex-col gap-0">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle className="text-xl">
              {editing ? "Edit Contact" : "Contact Details"}
            </SheetTitle>
            <SheetDescription className="text-sm">
              {editing
                ? "Update this contact's information."
                : "View and manage this contact."}
            </SheetDescription>
          </SheetHeader>

          {editing ? (
            <form
              onSubmit={handleSave}
              className="flex flex-1 flex-col overflow-y-auto"
            >
              <div className="flex-1 space-y-6 px-6 py-6">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`edit-name-${currentContact.id}`}>Name</Label>
                  <Input
                    id={`edit-name-${currentContact.id}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-10"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`edit-phone-${currentContact.id}`}>Phone</Label>
                  <Input
                    id={`edit-phone-${currentContact.id}`}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className="h-10"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Tag</Label>
                  <Select
                    value={tag}
                    onValueChange={(value) => setTag(value ?? "")}
                  >
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="Select a tag" />
                    </SelectTrigger>

                    <SelectContent>
                      {TAG_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`edit-date-${currentContact.id}`}>
                    Date Saved to Phonebook
                  </Label>
                  <div className="relative">
                    <CalendarIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={`edit-date-${currentContact.id}`}
                      type="date"
                      value={dateSaved}
                      onChange={(event) => setDateSaved(event.target.value)}
                      className="h-10 pl-9"
                    />
                  </div>
                </div>

                {error && (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <SheetFooter className="border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    loadContact();
                    setEditing(false);
                    setError(null);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Contact"}
                </Button>
              </SheetFooter>
            </form>
          ) : (
            <>
              <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                <div className="rounded-lg border bg-background px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</p>
                      <p className="truncate text-base font-medium">{currentContact.name}</p>
                    </div>
                    <Button type="button" variant="outline" onClick={beginEdit} className="shrink-0">Edit</Button>
                  </div>
                </div>
                <div className="rounded-lg border bg-background px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</p>
                      <p className="truncate">{currentContact.phone}</p>
                    </div>
                    <Button type="button" variant="outline" onClick={copyPhone} className="shrink-0"><Copy className="size-4" />Copy</Button>
                  </div>
                </div>
                <div className="rounded-lg border bg-background px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
                      {currentContact.tags?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {currentContact.tags.map((contactTag) => (
                            <span key={contactTag} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{contactTag}</span>
                          ))}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                  </div>
                    <Button type="button" variant="outline" onClick={() => { setSelectedTagToAdd(""); setAddingTag(true); }} className="shrink-0"><Plus className="size-4" />Add Tag</Button>
                  </div>
                </div>
                <div className="rounded-lg border bg-background px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Groups</p>
                    {currentContact.contact_groups?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {currentContact.contact_groups.map(({ groups }) => {
                          const group = Array.isArray(groups) ? groups[0] : groups;
                          return <span key={group.id} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{group.name}</span>;
                        })}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                    </div>
                    <Button type="button" variant="outline" onClick={openAddGroups} className="shrink-0"><Plus className="size-4" />Add to Group</Button>
                  </div>
                </div>
                <div className="rounded-lg border bg-background px-4 py-4">
                  <div className="min-w-0 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date Saved</p>
                    <p>{new Date(currentContact.date_saved).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                  </div>
                </div>

                {error && (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <SheetFooter className="border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={deleting}
                >
                  <Trash2 className="size-4" />
                  Delete Contact
                </Button>
                <div className="flex gap-2">
                  <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
                  <Button type="button" onClick={beginEdit}>
                    Edit Contact
                  </Button>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete contact?</DialogTitle>
            <DialogDescription>
              This will permanently remove this contact. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addingTag} onOpenChange={setAddingTag}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
            <DialogDescription>Choose an available tag for this contact.</DialogDescription>
          </DialogHeader>
          <Select value={selectedTagToAdd} onValueChange={(value) => setSelectedTagToAdd(value ?? "")}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select a tag" /></SelectTrigger>
            <SelectContent>
              {TAG_OPTIONS.filter((option) => !currentContact.tags?.some((tagValue) => tagValue.toLowerCase() === option.toLowerCase())).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={handleAddTag} disabled={!selectedTagToAdd || addingTag}>{addingTag && selectedTagToAdd ? "Adding..." : "Add Tag"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addingGroups} onOpenChange={(next) => { setAddingGroups(next); if (!next) setSelectedGroupIds(new Set()); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Group</DialogTitle>
            <DialogDescription>Select one or more groups for this contact.</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded-lg border">
            {loadingGroups ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading groups...</p> : availableGroups.length ? <div className="divide-y">{availableGroups.map((availableGroup) => <label key={availableGroup.id} className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-muted/20"><input type="checkbox" checked={selectedGroupIds.has(availableGroup.id)} onChange={() => toggleGroupSelection(availableGroup.id)} className="size-4 cursor-pointer accent-primary" /><span className="text-sm font-medium">{availableGroup.name}</span></label>)}</div> : <p className="px-4 py-8 text-center text-sm text-muted-foreground">All groups are already assigned.</p>}
          </div>
          <p className="text-sm font-medium text-muted-foreground">{selectedGroupIds.size} group{selectedGroupIds.size === 1 ? "" : "s"} selected</p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={handleAddGroups} disabled={!selectedGroupIds.size || savingGroups || loadingGroups}>{savingGroups ? "Adding..." : "Add to Group"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";

import { createSection, deleteSection, renameSection } from "@/app/contacts/section-actions";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SectionWithCount } from "@/lib/section-filter";

/** Add, rename and delete contact sections. */
export function ManageSectionsDialog({
  open,
  onOpenChange,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionWithCount[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: string } | { success: true }>, done: string) {
    setError(null);
    setWorking(true);
    const result = await action();
    setWorking(false);
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    toast(done);
    router.refresh();
    return true;
  }

  async function handleAdd() {
    if (await run(() => createSection(newName), "Section added")) setNewName("");
  }

  async function handleRename(id: string) {
    if (await run(() => renameSection(id, editName), "Section renamed")) setEditingId(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (working) return;
        onOpenChange(next);
        if (!next) {
          setError(null);
          setEditingId(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage sections</DialogTitle>
          <DialogDescription>
            Each contact belongs to one section, shown as tabs on Contacts and Investors. A section can
            be deleted once it has no contacts.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-md border">
          {sections.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No sections yet.</li>}
          {sections.map((section) => (
            <li key={section.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editingId === section.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleRename(section.id);
                    }}
                    aria-label="Section name"
                    className="h-8"
                    autoFocus
                    disabled={working}
                  />
                  <Button size="icon-sm" variant="ghost" aria-label="Save name" onClick={() => handleRename(section.id)} disabled={working}>
                    <Check className="size-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditingId(null)} disabled={working}>
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate">{section.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {section.count.toLocaleString("en-IN")} contact{section.count === 1 ? "" : "s"}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Rename ${section.name}`}
                    onClick={() => {
                      setEditingId(section.id);
                      setEditName(section.name);
                      setError(null);
                    }}
                    disabled={working}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${section.name}`}
                    onClick={() => run(() => deleteSection(section.id), "Section deleted")}
                    disabled={working}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newName.trim()) handleAdd();
            }}
            placeholder="New section name"
            aria-label="New section name"
            disabled={working}
          />
          <Button onClick={handleAdd} disabled={working || !newName.trim()}>
            Add
          </Button>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

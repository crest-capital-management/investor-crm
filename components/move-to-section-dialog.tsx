"use client";

import { useState } from "react";

import { moveContactsToSection } from "@/app/contacts/section-actions";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContactSection } from "@/lib/section-filter";

/** Moves the selected contacts into one section. */
export function MoveToSectionDialog({
  open,
  onOpenChange,
  ids,
  sections,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  sections: ContactSection[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = Object.fromEntries(sections.map((s) => [s.id, s.name]));
  const target = sections.find((s) => s.id === sectionId);

  async function handleMove() {
    if (!sectionId) return;
    setError(null);
    setWorking(true);
    const result = await moveContactsToSection(ids, sectionId);
    setWorking(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    toast(`${result.updated} contact${result.updated === 1 ? "" : "s"} moved to ${target?.name ?? "the section"}`);
    setSectionId("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (working) return;
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {ids.length} contact{ids.length === 1 ? "" : "s"} to a section</DialogTitle>
          <DialogDescription>Each contact is in one section; this replaces their current section.</DialogDescription>
        </DialogHeader>

        <Select items={items} value={sectionId} onValueChange={(value) => setSectionId(value ?? "")}>
          <SelectTrigger className="w-full" aria-label="Section">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={working} />}>Cancel</DialogClose>
          <Button type="button" onClick={handleMove} disabled={!sectionId || working}>
            {working ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

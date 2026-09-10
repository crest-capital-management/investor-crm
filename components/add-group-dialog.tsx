"use client";

import { useState } from "react";

import { addGroup } from "@/app/groups/actions";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function AddGroupDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Group name is required.");
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.set("name", trimmedName);
    const result = await addGroup(formData);
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      toast("Failed to create group", "error");
      return;
    }

    setOpen(false);
    reset();
    toast("Group created successfully");
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <SheetTrigger render={<Button />}>+ Add Group</SheetTrigger>
      <SheetContent side="right" className="flex flex-col gap-0">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-xl">Add Group</SheetTitle>
          <SheetDescription className="text-sm">Create a group for organizing contacts.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-6 px-6 py-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="group-name">Group name</Label>
              <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Family Offices" className="h-10" />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
          <SheetFooter className="border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end">
            <SheetClose render={<Button variant="outline" type="button" className="h-10" />}>Cancel</SheetClose>
            <Button type="submit" disabled={submitting} className="h-10">{submitting ? "Saving..." : "Save Group"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
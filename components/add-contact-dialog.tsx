"use client";

import { useState } from "react";

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
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { addContact } from "@/app/contacts/actions";
import { useToast } from "@/components/toast-provider";

export const TAG_OPTIONS = ["Investor", "Alumni", "Prospect", "Partner", "Advisor"];

function toISODateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function AddContactDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [selectedTag, setSelectedTag] = useState<string>("");

  const [dateSaved, setDateSaved] = useState<Date | undefined>(undefined);
  const [dateError, setDateError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setPhone("");
    setNameError(null);
    setPhoneError(null);
    setSelectedTag("");
    setDateSaved(undefined);
    setDateError(null);
    setError(null);
  }

  async function handleSubmit(formData: FormData) {
    setNameError(null);
    setPhoneError(null);
    setDateError(null);
    setError(null);

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    let hasError = false;

    if (!trimmedName) {
      setNameError("Name is required.");
      hasError = true;
    }

    if (!trimmedPhone) {
      setPhoneError("Phone number is required.");
      hasError = true;
    } else if (!/^\d{7,15}$/.test(trimmedPhone)) {
      setPhoneError(
        "Enter a valid phone number (digits only, 7-15 digits)."
      );
      hasError = true;
    }

    if (!dateSaved) {
      setDateError("Date is required.");
      hasError = true;
    }

    if (hasError) return;

    formData.set("name", trimmedName);
    formData.set("phone", trimmedPhone);
    formData.set(
      "tags",
      JSON.stringify(selectedTag ? [selectedTag] : [])
    );
    formData.set(
      "dateSaved",
      dateSaved ? toISODateString(dateSaved) : ""
    );

    setSubmitting(true);

    const result = await addContact(formData);

    setSubmitting(false);

    if (result?.error) {
      toast("Failed to create contact", "error");
      return;
    }

    resetForm();
    setOpen(false);
    toast("Contact created successfully");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          resetForm();
        }
      }}
    >
      <SheetTrigger render={<Button />}>+ Add Contact</SheetTrigger>

      {/* Right-side Sheet is intentionally preserved */}
      <SheetContent side="right" className="flex flex-col gap-0">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-xl">Add Contact</SheetTitle>
          <SheetDescription className="text-sm">
            Enter the contact&apos;s details below.
          </SheetDescription>
        </SheetHeader>

        <form
          action={handleSubmit}
          className="flex flex-1 flex-col overflow-y-auto"
        >
          <div className="flex-1 space-y-6 px-6 py-6">
            <div>
              <p className="text-sm font-medium">Contact details</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add the basic information for this contact.
              </p>
            </div>

            {/* Name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>

              <Input
                id="name"
                name="name"
                placeholder="e.g. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10"
              />

              {nameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>

            {/* Phone */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Phone</Label>

              <Input
                id="phone"
                name="phone"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-10"
              />

              {phoneError && (
                <p className="text-sm text-destructive">{phoneError}</p>
              )}
            </div>

            {/* Tag */}
            <div className="flex flex-col gap-2">
              <Label>Tag</Label>

              <Select
                value={selectedTag}
                onValueChange={(value) => setSelectedTag(value ?? "")}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Select a tag" />
                </SelectTrigger>

                <SelectContent>
                  {TAG_OPTIONS.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="flex flex-col gap-2">
              <Label>Date Saved to Phonebook</Label>

              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full justify-start gap-2 font-normal"
                    />
                  }
                >
                  <CalendarIcon className="size-4" />

                  {dateSaved ? (
                    dateSaved.toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  ) : (
                    <span className="text-muted-foreground">
                      Pick a date
                    </span>
                  )}
                </PopoverTrigger>

                <PopoverContent
                  className="w-auto p-0"
                  align="start"
                >
                  <Calendar
                    mode="single"
                    selected={dateSaved}
                    onSelect={setDateSaved}
                  />
                </PopoverContent>
              </Popover>

              {dateError && (
                <p className="text-sm text-destructive">{dateError}</p>
              )}
            </div>

            {error && (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <SheetFooter className="border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end">
            <SheetClose
              render={
                <Button
                  variant="outline"
                  type="button"
                  className="h-10"
                />
              }
            >
              Cancel
            </SheetClose>

            <Button
              type="submit"
              disabled={submitting}
              className="h-10"
            >
              {submitting ? "Saving..." : "Save Contact"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
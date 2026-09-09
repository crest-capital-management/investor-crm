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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { addContact } from "@/app/contacts/actions";

const TAG_OPTIONS = ["Investor", "Alumni", "Prospect", "Partner", "Advisor"];

function toISODateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AddContactDialog() {
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
      setPhoneError("Enter a valid phone number (digits only, 7-15 digits).");
      hasError = true;
    }

    if (!dateSaved) {
      setDateError("Date is required.");
      hasError = true;
    }

    if (hasError) return;

    formData.set("name", trimmedName);
    formData.set("phone", trimmedPhone);
    formData.set("tags", JSON.stringify(selectedTag ? [selectedTag] : []));
    formData.set("dateSaved", dateSaved ? toISODateString(dateSaved) : "");

    setSubmitting(true);
    const result = await addContact(formData);
    setSubmitting(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    resetForm();
    setOpen(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <SheetTrigger render={<Button />}>+ Add Contact</SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Add Contact</SheetTitle>
          <SheetDescription>Enter the contact&apos;s details below.</SheetDescription>
        </SheetHeader>
        <form action={handleSubmit} className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {phoneError && <p className="text-sm text-destructive">{phoneError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tag</Label>
            <Select value={selectedTag} onValueChange={(value) => setSelectedTag(value ?? "")}>
              <SelectTrigger className="w-full">
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

          <div className="flex flex-col gap-1.5">
            <Label>Date Saved to Phonebook</Label>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-2 font-normal"
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
                  <span className="text-muted-foreground">Pick a date</span>
                )}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dateSaved} onSelect={setDateSaved} />
              </PopoverContent>
            </Popover>
            {dateError && <p className="text-sm text-destructive">{dateError}</p>}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <SheetFooter className="flex-row justify-end px-0">
            <SheetClose render={<Button variant="outline" type="button" />}>Cancel</SheetClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

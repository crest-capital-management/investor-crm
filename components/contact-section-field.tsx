"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { moveContactsToSection } from "@/app/contacts/section-actions";
import { useToast } from "@/components/toast-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContactSection } from "@/lib/section-filter";

/** The contact's section on its detail page, changeable in place. */
export function ContactSectionField({
  contactId,
  sectionId,
  sections,
}: {
  contactId: string;
  sectionId: string | null;
  sections: ContactSection[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(sectionId ?? "");
  const [saving, setSaving] = useState(false);

  async function handleChange(next: string) {
    if (!next || next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    const result = await moveContactsToSection([contactId], next);
    setSaving(false);
    if ("error" in result) {
      setValue(previous);
      toast(result.error, "error");
      return;
    }
    toast(`Moved to ${sections.find((s) => s.id === next)?.name ?? "the section"}`);
    router.refresh();
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Section</p>
      <Select
        items={Object.fromEntries(sections.map((s) => [s.id, s.name]))}
        value={value}
        onValueChange={(next) => handleChange(next ?? "")}
        disabled={saving}
      >
        <SelectTrigger className="mt-1 h-9 w-full max-w-56" aria-label="Section">
          <SelectValue placeholder="No section" />
        </SelectTrigger>
        <SelectContent>
          {sections.map((section) => (
            <SelectItem key={section.id} value={section.id}>
              {section.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

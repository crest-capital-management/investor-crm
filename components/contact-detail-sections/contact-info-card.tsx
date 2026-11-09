"use client";

import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { ContactSectionField } from "@/components/contact-section-field";
import type { ContactRow } from "@/components/contact-details-dialog";
import type { ContactSection } from "@/lib/section-filter";

/** The contact's details (name, company, section, phone, email, tags, notes) with copy buttons. */
export function ContactInfoCard({
  contact,
  isInvestor,
  section,
}: {
  contact: ContactRow;
  isInvestor: boolean;
  section: { sectionId: string | null; sections: ContactSection[] } | null;
}) {
  const { toast } = useToast();

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(contact.phone);
      toast("Phone number copied");
    } catch {
      toast("Could not copy phone number", "error");
    }
  }

  async function copyEmail() {
    if (!contact.email) return;
    try {
      await navigator.clipboard.writeText(contact.email);
      toast("Email copied");
    } catch {
      toast("Could not copy email", "error");
    }
  }

  return (
    <section className="rounded-lg border bg-background p-5">
      <h2 className="text-base font-semibold">{isInvestor ? "Investor" : "Contact"}</h2>
      <div className="mt-4 space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</p>
          <p className="mt-1 font-medium">{contact.name}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Company</p>
          {contact.company ? (
            <p className="mt-1">{contact.company}</p>
          ) : (
            <p className="mt-1 text-muted-foreground">No company added</p>
          )}
        </div>
        {section && section.sections.length > 0 && (
          <ContactSectionField contactId={contact.id} sectionId={section.sectionId} sections={section.sections} />
        )}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</p>
            <p className="mt-1 break-words">{contact.phone}</p>
          </div>
          <Button type="button" variant="outline" onClick={copyPhone} className="shrink-0">
            <Copy className="size-4" />
            Copy
          </Button>
        </div>
        {contact.email ? (
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="mt-1 break-words">{contact.email}</p>
            </div>
            <Button type="button" variant="outline" onClick={copyEmail} className="shrink-0">
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
            <p className="mt-1 text-muted-foreground">No email added</p>
          </div>
        )}
        {isInvestor ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
            <span className="mt-1 inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Investor
            </span>
          </div>
        ) : (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
            {contact.tags?.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {contact.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">No tags assigned</p>
            )}
          </div>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
          {contact.notes?.trim() ? (
            <p className="mt-1 whitespace-pre-wrap">{contact.notes}</p>
          ) : (
            <p className="mt-1 text-muted-foreground">No notes yet — e.g. company name, designation, sector</p>
          )}
        </div>
      </div>
    </section>
  );
}

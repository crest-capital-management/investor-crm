"use client";

import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";

import type { FollowUp } from "@/app/investors/actions";
import type { MeetingNote } from "@/app/contacts/actions";
import { Button } from "@/components/ui/button";
import { ContactDetailsDialog, type ContactRow } from "@/components/contact-details-dialog";
import { PortfolioUpdatesSection } from "@/components/portfolio-updates-section";
import { ProspectScoreSection } from "@/components/prospect-score-section";
import { MessageDraftSection } from "@/components/message-draft-section";
import type { WhatsAppMessage } from "@/components/whatsapp-history";
import { ContactInfoCard } from "@/components/contact-detail-sections/contact-info-card";
import { FollowUpsSection } from "@/components/contact-detail-sections/follow-ups-section";
import { MeetingNotesSection } from "@/components/contact-detail-sections/meeting-notes-section";
import { ContactChat } from "@/components/contact-detail-sections/contact-chat";
import { EMPTY_PROSPECT_SCORE, type ProspectScore } from "@/lib/prospect-score-types";
import type { PortfolioUpdate } from "@/lib/portfolio-types";
import type { ContactSection } from "@/lib/section-filter";

export type { WhatsAppMessage };

type ContactDetailProps = {
  /** "investor" is the Investors page's version: same screen, investor wording. */
  variant?: "contact" | "investor";
  contact: ContactRow;
  initialNotes: MeetingNote[];
  notesError: string | null;
  initialFollowUps: FollowUp[];
  followUpsError: string | null;
  initialWhatsAppMessages?: WhatsAppMessage[];
  whatsAppMessagesError?: string | null;
  initialWhatsAppSummary?: string | null;
  initialWhatsAppSummaryGeneratedAt?: string | null;
  initialUnreadCount?: number;
  initialPortfolioUpdates?: PortfolioUpdate[];
  portfolioUpdatesError?: string | null;
  initialProspectScore?: ProspectScore;
  prospectScoreError?: string | null;
  /** The contact's section and the sections to choose from (null before sections are set up). */
  section?: { sectionId: string | null; sections: ContactSection[] } | null;
};

/**
 * The contact (or investor) detail screen. Each section manages its own data;
 * this component only lays them out:
 *   left:  details, prospect score
 *   right: follow-ups, portfolio updates, meeting notes, WhatsApp chat, message draft
 */
export function ContactDetail({
  variant = "contact",
  contact,
  initialNotes,
  notesError,
  initialFollowUps,
  followUpsError,
  initialWhatsAppMessages = [],
  whatsAppMessagesError = null,
  initialWhatsAppSummary = null,
  initialWhatsAppSummaryGeneratedAt = null,
  initialUnreadCount = 0,
  initialPortfolioUpdates = [],
  portfolioUpdatesError = null,
  initialProspectScore = EMPTY_PROSPECT_SCORE,
  prospectScoreError = null,
  section = null,
}: ContactDetailProps) {
  const isInvestor = variant === "investor";

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={isInvestor ? "/investors" : "/contacts"}
            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to {isInvestor ? "Investors" : "Contacts"}
          </Link>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{isInvestor ? "Investor" : "Contact"} relationship details</p>
        </div>
        <ContactDetailsDialog contact={contact} startInEditMode nativeButtonTrigger>
          <Button type="button" variant="outline" className="shrink-0">
            <Pencil className="size-4" />
            Edit {isInvestor ? "Investor" : "Contact"}
          </Button>
        </ContactDetailsDialog>
      </div>

      <div className="mt-6 mb-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <ContactInfoCard contact={contact} isInvestor={isInvestor} section={section} />

          <ProspectScoreSection contactId={contact.id} initialScore={initialProspectScore} error={prospectScoreError} />
        </div>
        <div className="space-y-4">
          <FollowUpsSection
            contactId={contact.id}
            isInvestor={isInvestor}
            initialFollowUps={initialFollowUps}
            followUpsError={followUpsError}
          />

          <PortfolioUpdatesSection
            contactId={contact.id}
            initialUpdates={initialPortfolioUpdates}
            error={portfolioUpdatesError}
          />

          <MeetingNotesSection
            contactId={contact.id}
            isInvestor={isInvestor}
            initialNotes={initialNotes}
            notesError={notesError}
          />

          <ContactChat
            contactId={contact.id}
            contactName={contact.name}
            initialMessages={initialWhatsAppMessages}
            error={whatsAppMessagesError}
            initialSummary={initialWhatsAppSummary}
            initialSummaryGeneratedAt={initialWhatsAppSummaryGeneratedAt}
            unreadCount={initialUnreadCount}
          />

          <MessageDraftSection contactId={contact.id} contactName={contact.name} />
        </div>
      </div>
    </div>
  );
}

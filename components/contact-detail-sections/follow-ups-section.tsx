"use client";

import { useState, type FormEvent } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";

import {
  addFollowUp,
  deleteCompletedFollowUp,
  deleteFollowUp,
  editFollowUp,
  getFollowUps,
  markFollowUpAsDone,
  suggestFollowUp,
  type FollowUp,
} from "@/app/investors/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIconTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, FollowUpFormDialog, startOfToday, toISODateString } from "./dialogs";

function formatFollowUpDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A contact's follow-ups: list, add (by hand or AI-suggested), edit, mark done and delete. */
export function FollowUpsSection({
  contactId,
  isInvestor,
  initialFollowUps,
  followUpsError,
}: {
  contactId: string;
  isInvestor: boolean;
  initialFollowUps: FollowUp[];
  followUpsError: string | null;
}) {
  const noun = isInvestor ? "investor" : "contact";
  const { toast } = useToast();

  const [followUps, setFollowUps] = useState(initialFollowUps);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [addingFollowUp, setAddingFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState<Date | undefined>(startOfToday());
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [suggestingFollowUp, setSuggestingFollowUp] = useState(false);
  const [completingFollowUpId, setCompletingFollowUpId] = useState<string | null>(null);
  const [confirmingCompleteFollowUp, setConfirmingCompleteFollowUp] = useState<FollowUp | null>(null);

  // Edit
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null);
  const [editFollowUpDate, setEditFollowUpDate] = useState<Date | undefined>(undefined);
  const [editFollowUpMessage, setEditFollowUpMessage] = useState("");
  const [savingEditFollowUp, setSavingEditFollowUp] = useState(false);

  // Delete (pending, and completed)
  const [deletingFollowUp, setDeletingFollowUp] = useState<FollowUp | null>(null);
  const [deletingFollowUpLoading, setDeletingFollowUpLoading] = useState(false);
  const [deletingCompletedFollowUp, setDeletingCompletedFollowUp] = useState<FollowUp | null>(null);
  const [deletingCompletedFollowUpLoading, setDeletingCompletedFollowUpLoading] = useState(false);

  async function refreshFollowUps() {
    setLoadingFollowUps(true);
    const result = await getFollowUps(contactId);
    setLoadingFollowUps(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setFollowUps(result.followUps ?? []);
  }

  function resetFollowUpForm() {
    setFollowUpDate(startOfToday());
    setFollowUpMessage("");
  }

  async function handleConfirmCompleteFollowUp() {
    if (!confirmingCompleteFollowUp) return;
    const followUpId = confirmingCompleteFollowUp.id;

    setCompletingFollowUpId(followUpId);
    const result = await markFollowUpAsDone(followUpId, contactId);
    setCompletingFollowUpId(null);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setConfirmingCompleteFollowUp(null);
    toast("Follow-up completed and interaction recorded.");
    await refreshFollowUps();
  }

  function startEditFollowUp(followUp: FollowUp) {
    setEditingFollowUp(followUp);
    setEditFollowUpDate(new Date(`${followUp.due_date}T00:00:00`));
    setEditFollowUpMessage(followUp.message);
  }

  async function handleSaveEditFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFollowUp) return;

    if (!editFollowUpDate) {
      toast("Follow-up date is required.", "error");
      return;
    }

    const normalizedMessage = editFollowUpMessage.trim();
    if (!normalizedMessage) {
      toast("Follow-up message is required.", "error");
      return;
    }

    setSavingEditFollowUp(true);
    const result = await editFollowUp(editingFollowUp.id, contactId, toISODateString(editFollowUpDate), normalizedMessage);
    setSavingEditFollowUp(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setEditingFollowUp(null);
    await refreshFollowUps();
    toast("Follow-up updated.");
  }

  async function handleConfirmDeleteFollowUp() {
    if (!deletingFollowUp) return;

    setDeletingFollowUpLoading(true);
    const result = await deleteFollowUp(deletingFollowUp.id, contactId);
    setDeletingFollowUpLoading(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setDeletingFollowUp(null);
    await refreshFollowUps();
    toast("Follow-up deleted.");
  }

  async function handleConfirmDeleteCompletedFollowUp() {
    if (!deletingCompletedFollowUp) return;

    setDeletingCompletedFollowUpLoading(true);
    const result = await deleteCompletedFollowUp(deletingCompletedFollowUp.id, contactId);
    setDeletingCompletedFollowUpLoading(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setDeletingCompletedFollowUp(null);
    await refreshFollowUps();
    toast("Follow-up deleted.");
  }

  async function handleSuggestFollowUp() {
    setSuggestingFollowUp(true);
    const result = await suggestFollowUp(contactId);
    setSuggestingFollowUp(false);

    if ("error" in result) {
      toast(result.error, "error");
      return;
    }
    if (!result.needed) {
      toast("No follow-up needed right now, based on WhatsApp history and meeting notes.");
      return;
    }

    setFollowUpDate(new Date(`${result.dueDate}T00:00:00`));
    setFollowUpMessage(result.message);
    setAddingFollowUp(true);
    toast("Follow-up suggestion ready — review and save below.");
  }

  async function handleAddFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!followUpDate) {
      toast("Follow-up date is required.", "error");
      return;
    }

    const normalizedMessage = followUpMessage.trim();
    if (!normalizedMessage) {
      toast("Follow-up message is required.", "error");
      return;
    }

    setSavingFollowUp(true);
    const result = await addFollowUp(contactId, toISODateString(followUpDate), normalizedMessage);
    setSavingFollowUp(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setAddingFollowUp(false);
    resetFollowUpForm();
    await refreshFollowUps();
    toast("Follow-up saved successfully");
  }

  return (
    <>
      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Follow-ups</h2>
            <p className="mt-1 text-sm text-muted-foreground">Keep track of future {noun} actions.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleSuggestFollowUp} disabled={suggestingFollowUp}>
              {suggestingFollowUp ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Suggest with AI
            </Button>
            <Button type="button" variant="outline" onClick={() => setAddingFollowUp(true)}>
              Add Follow-up
            </Button>
          </div>
        </div>
        <div className="mt-5">
          {followUpsError ? (
            <p className="text-sm text-destructive">{followUpsError}</p>
          ) : loadingFollowUps ? (
            <p className="text-sm text-muted-foreground">Loading follow-ups...</p>
          ) : followUps.length ? (
            <div className="space-y-4">
              {followUps.map((followUp) => (
                <div
                  key={followUp.id}
                  id={`followup-${followUp.id}`}
                  className="scroll-mt-24 target:rounded-md target:bg-accent/40 flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{formatFollowUpDate(followUp.due_date)}</p>
                      {followUp.is_done && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <Check className="size-3 text-green-600" />
                          Completed
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{followUp.message}</p>
                  </div>
                  <div className="shrink-0">
                    <DropdownMenu>
                      <DropdownMenuIconTrigger label="Follow-up actions" />
                      <DropdownMenuContent>
                        {!followUp.is_done ? (
                          <>
                            <DropdownMenuItem onClick={() => startEditFollowUp(followUp)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setConfirmingCompleteFollowUp(followUp)}>
                              Mark as Done
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletingFollowUp(followUp)}
                              className="text-destructive focus:text-destructive"
                            >
                              Delete
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => setDeletingCompletedFollowUp(followUp)}
                            className="text-destructive focus:text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No follow-ups scheduled yet.</p>
          )}
        </div>
      </section>

      <FollowUpFormDialog
        open={addingFollowUp}
        onOpenChange={(next) => {
          setAddingFollowUp(next);
          if (!next) resetFollowUpForm();
        }}
        title="Add Follow-up"
        description={`Schedule a future action for this ${noun}.`}
        messageId="contact-follow-up-message"
        date={followUpDate}
        onDateChange={setFollowUpDate}
        message={followUpMessage}
        onMessageChange={setFollowUpMessage}
        placeholder={isInvestor ? "e.g. Send the updated investment proposal." : "e.g. Send the updated proposal."}
        saving={savingFollowUp}
        submitLabel="Save Follow-up"
        onSubmit={handleAddFollowUp}
      />

      <FollowUpFormDialog
        open={Boolean(editingFollowUp)}
        onOpenChange={(next) => {
          if (!next) {
            setEditingFollowUp(null);
            setEditFollowUpDate(undefined);
            setEditFollowUpMessage("");
          }
        }}
        title="Edit Follow-up"
        description="Update the date or message for this follow-up."
        messageId="contact-edit-follow-up-message"
        date={editFollowUpDate}
        onDateChange={setEditFollowUpDate}
        message={editFollowUpMessage}
        onMessageChange={setEditFollowUpMessage}
        saving={savingEditFollowUp}
        submitLabel="Save Changes"
        onSubmit={handleSaveEditFollowUp}
      />

      <ConfirmDialog
        open={Boolean(deletingFollowUp)}
        onClose={() => setDeletingFollowUp(null)}
        title="Delete Follow-up?"
        description="Are you sure you want to delete this follow-up? This action cannot be undone."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy={deletingFollowUpLoading}
        destructive
        onConfirm={handleConfirmDeleteFollowUp}
      />

      {/* Stronger warning: the follow-up was already completed. */}
      <ConfirmDialog
        open={Boolean(deletingCompletedFollowUp)}
        onClose={() => setDeletingCompletedFollowUp(null)}
        title="Delete completed follow-up?"
        descriptionClassName="space-y-2"
        description={
          <>
            <span>This follow-up has already been marked as completed.</span>
            <span className="block">
              Deleting it will remove the follow-up from this {noun}&apos;s follow-up history.
            </span>
            <span className="block">
              The completion interaction will remain in the {noun}&apos;s interaction history.
            </span>
            <span className="block font-medium text-foreground">This action cannot be undone.</span>
          </>
        }
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy={deletingCompletedFollowUpLoading}
        destructive
        onConfirm={handleConfirmDeleteCompletedFollowUp}
      />

      <ConfirmDialog
        open={Boolean(confirmingCompleteFollowUp)}
        onClose={() => setConfirmingCompleteFollowUp(null)}
        title="Mark follow-up as completed?"
        description={`This will mark this follow-up as completed and add it to the ${noun}'s interaction history.`}
        confirmLabel="Mark as Done"
        busyLabel="Marking..."
        busy={Boolean(completingFollowUpId)}
        onConfirm={handleConfirmCompleteFollowUp}
      />
    </>
  );
}

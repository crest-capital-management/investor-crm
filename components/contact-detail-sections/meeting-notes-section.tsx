"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Loader2, Mic } from "lucide-react";

import {
  addMeetingNote,
  deleteMeetingNote,
  getMeetingNotes,
  transcribeVoiceNote,
  updateMeetingNote,
  type MeetingNote,
} from "@/app/contacts/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIconTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, NoteTextDialog } from "./dialogs";

function NoteHistory({
  notes,
  onEdit,
  onDelete,
  noun,
}: {
  notes: MeetingNote[];
  onEdit: (note: MeetingNote) => void;
  onDelete: (note: MeetingNote) => void;
  noun: string;
}) {
  return notes.length ? (
    <div className="space-y-4">
      {notes.map((meetingNote) => {
        const createdAt = new Date(meetingNote.created_at);
        return (
          <div
            key={meetingNote.id}
            className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs text-muted-foreground">
                {createdAt.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}{" "}
                ·{" "}
                {createdAt.toLocaleTimeString("en-IN", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </p>
              <p className="whitespace-pre-wrap text-sm">{meetingNote.note}</p>
            </div>
            <div className="shrink-0">
              <DropdownMenu>
                <DropdownMenuIconTrigger label="Meeting note actions" />
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onEdit(meetingNote)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(meetingNote)}
                    className="text-destructive focus:text-destructive"
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">Record what was discussed with this {noun}.</p>
  );
}

/** A contact's meeting notes: list, add (typed or from a voice note), edit and delete. */
export function MeetingNotesSection({
  contactId,
  isInvestor,
  initialNotes,
  notesError,
}: {
  contactId: string;
  isInvestor: boolean;
  initialNotes: MeetingNote[];
  notesError: string | null;
}) {
  const noun = isInvestor ? "investor" : "contact";
  const { toast } = useToast();

  const [notes, setNotes] = useState(initialNotes);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [addingMeetingNote, setAddingMeetingNote] = useState(false);
  const [meetingNote, setMeetingNote] = useState("");
  const [savingMeetingNote, setSavingMeetingNote] = useState(false);
  const [transcribingVoiceNote, setTranscribingVoiceNote] = useState(false);
  const voiceNoteInputRef = useRef<HTMLInputElement>(null);

  const [editingMeetingNote, setEditingMeetingNote] = useState<MeetingNote | null>(null);
  const [editMeetingNoteText, setEditMeetingNoteText] = useState("");
  const [savingEditMeetingNote, setSavingEditMeetingNote] = useState(false);

  const [deletingMeetingNote, setDeletingMeetingNote] = useState<MeetingNote | null>(null);
  const [deletingMeetingNoteLoading, setDeletingMeetingNoteLoading] = useState(false);

  async function refreshNotes() {
    setLoadingNotes(true);
    const result = await getMeetingNotes(contactId);
    setLoadingNotes(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setNotes(result.notes ?? []);
  }

  function startEditMeetingNote(note: MeetingNote) {
    setEditingMeetingNote(note);
    setEditMeetingNoteText(note.note);
  }

  async function handleSaveEditMeetingNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMeetingNote) return;

    const normalizedNote = editMeetingNoteText.trim();
    if (!normalizedNote) {
      toast("Meeting note is required.", "error");
      return;
    }

    setSavingEditMeetingNote(true);
    const result = await updateMeetingNote(editingMeetingNote.id, contactId, normalizedNote);
    setSavingEditMeetingNote(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setEditingMeetingNote(null);
    await refreshNotes();
    toast("Meeting note updated.");
  }

  async function handleConfirmDeleteMeetingNote() {
    if (!deletingMeetingNote) return;

    setDeletingMeetingNoteLoading(true);
    const result = await deleteMeetingNote(deletingMeetingNote.id, contactId);
    setDeletingMeetingNoteLoading(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setDeletingMeetingNote(null);
    await refreshNotes();
    toast("Meeting note deleted.");
  }

  async function handleVoiceNoteFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setTranscribingVoiceNote(true);
    const result = await transcribeVoiceNote(contactId, file);
    setTranscribingVoiceNote(false);

    if ("error" in result) {
      toast(result.error, "error");
      return;
    }

    setMeetingNote(result.transcript);
    setAddingMeetingNote(true);
    toast("Voice note transcribed — review and save below.");
  }

  async function handleAddMeetingNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedNote = meetingNote.trim();

    if (!normalizedNote) {
      toast("Meeting note is required.", "error");
      return;
    }

    setSavingMeetingNote(true);
    const result = await addMeetingNote(contactId, normalizedNote);
    setSavingMeetingNote(false);

    if (result.error) {
      toast(result.error, "error");
      return;
    }

    setMeetingNote("");
    setAddingMeetingNote(false);
    await refreshNotes();
    toast("Meeting note saved successfully");
  }

  return (
    <>
      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Meeting Notes</h2>
            <p className="mt-1 text-sm text-muted-foreground">Record and review {noun} conversations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={voiceNoteInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleVoiceNoteFileChange}
              disabled={transcribingVoiceNote}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => voiceNoteInputRef.current?.click()}
              disabled={transcribingVoiceNote}
            >
              {transcribingVoiceNote ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
              {transcribingVoiceNote ? "Transcribing..." : "Upload Voice Note"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAddingMeetingNote(true)}>
              Add Meeting Note
            </Button>
          </div>
        </div>
        <div className="mt-5">
          {notesError ? (
            <p className="text-sm text-destructive">{notesError}</p>
          ) : loadingNotes ? (
            <p className="text-sm text-muted-foreground">Loading meeting notes...</p>
          ) : (
            <NoteHistory notes={notes} onEdit={startEditMeetingNote} onDelete={setDeletingMeetingNote} noun={noun} />
          )}
        </div>
      </section>

      <NoteTextDialog
        open={addingMeetingNote}
        onOpenChange={(next) => {
          setAddingMeetingNote(next);
          if (!next) setMeetingNote("");
        }}
        title="Add Meeting Note"
        description={`Record what was discussed with this ${noun}.`}
        textareaId="contact-meeting-note"
        value={meetingNote}
        onChange={setMeetingNote}
        placeholder={isInvestor ? "e.g. Discussed Q4 investment priorities." : "e.g. Discussed project timeline."}
        saving={savingMeetingNote}
        submitLabel="Save Meeting Note"
        onSubmit={handleAddMeetingNote}
      />

      <NoteTextDialog
        open={Boolean(editingMeetingNote)}
        onOpenChange={(next) => {
          if (!next) setEditingMeetingNote(null);
        }}
        title="Edit Meeting Note"
        description="Update the notes from this meeting. The original date and time will remain unchanged."
        textareaId="contact-edit-meeting-note"
        value={editMeetingNoteText}
        onChange={setEditMeetingNoteText}
        saving={savingEditMeetingNote}
        submitLabel="Save Changes"
        onSubmit={handleSaveEditMeetingNote}
      />

      <ConfirmDialog
        open={Boolean(deletingMeetingNote)}
        onClose={() => setDeletingMeetingNote(null)}
        title="Delete meeting note?"
        description="Are you sure you want to delete this meeting note? This action cannot be undone."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy={deletingMeetingNoteLoading}
        destructive
        onConfirm={handleConfirmDeleteMeetingNote}
      />
    </>
  );
}

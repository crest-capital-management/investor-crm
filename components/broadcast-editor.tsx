"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileText, X } from "lucide-react";

import {
  createBroadcastDraft,
  createScheduledBroadcast,
  updateBroadcast,
  type BroadcastData,
  type ContactOption,
  type GroupOption,
  type TargetType,
  type TemplateOption,
} from "@/app/broadcasts/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/toast-provider";
import { AudiencePicker } from "@/components/broadcast-editor-parts/audience-picker";
import {
  combineDateAndTime,
  getDefaultFutureTime,
  parseScheduledDateTime,
  SchedulePicker,
  type Period,
} from "@/components/broadcast-editor-parts/schedule-picker";
import {
  computeResolvedMessage,
  createDefaultMappings,
  SAMPLE_PREVIEW_CONTACT,
} from "@/components/broadcast-editor-parts/template-mapping";
import { VariableMappingsPanel } from "@/components/broadcast-editor-parts/variable-mappings";
import {
  extractPlaceholders,
  SUPPORTED_CONTACT_FIELDS,
  type SupportedContactField,
  type VariableMapping,
  type VariableMappings,
  type VariableMappingType,
} from "@/lib/template-placeholders";
import { cn } from "@/lib/utils";
import type { ContactSection } from "@/lib/section-filter";

export interface BroadcastEditorProps {
  mode: "create" | "edit";
  groups: GroupOption[];
  contacts: ContactOption[];
  /** Contact sections (e.g. Nixon, Girish) to narrow the manual contact list. */
  sections?: ContactSection[];
  templates?: TemplateOption[];
  existingBroadcast?: BroadcastData | null;
}

/**
 * Creates or edits a broadcast: the message (typed, or from a template with
 * variable mappings), the audience, and when to send. Holds all the form state
 * because saving checks all three together; the audience and schedule pickers
 * are controlled components in components/broadcast-editor-parts.
 */
export function BroadcastEditor({
  mode,
  groups = [],
  contacts = [],
  sections = [],
  templates = [],
  existingBroadcast,
}: BroadcastEditorProps) {
  const router = useRouter();
  const { toast } = useToast();

  const isEditing = mode === "edit" && Boolean(existingBroadcast);
  const isEditingScheduled = existingBroadcast?.status === "scheduled";
  const isSent = existingBroadcast?.status === "sent";
  const isSending = existingBroadcast?.status === "sending";
  const isReadOnly = isSent || isSending;

  // ---- Message and template ----
  const [messageText, setMessageText] = useState(() => {
    return existingBroadcast?.message_text ?? "";
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => {
    return existingBroadcast?.template_id ?? "";
  });
  const [templateSourceBody, setTemplateSourceBody] = useState<string>(() => {
    if (existingBroadcast?.template_id && templates.length > 0) {
      const tmpl = templates.find((t) => t.id === existingBroadcast.template_id);
      return tmpl?.body_text ?? "";
    }
    return "";
  });
  const [templateMode, setTemplateMode] = useState<"custom" | "template">(() => {
    return existingBroadcast?.template_id ? "template" : "custom";
  });
  const [variableMappings, setVariableMappings] = useState<VariableMappings>(() => {
    if (existingBroadcast?.template_id && templates.length > 0) {
      const tmpl = templates.find((t) => t.id === existingBroadcast.template_id);
      if (tmpl) {
        return createDefaultMappings(extractPlaceholders(tmpl.body_text), existingBroadcast.variable_mappings);
      }
    }
    return {};
  });

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) ?? null;
  }, [templates, selectedTemplateId]);
  const isMetaTemplate = Boolean(selectedTemplate?.meta_template_id);

  // Detected placeholders in current template source body
  const detectedPlaceholders = useMemo(() => {
    if (!templateSourceBody) return [];
    return extractPlaceholders(templateSourceBody);
  }, [templateSourceBody]);

  // ---- Audience ----
  const [targetType, setTargetType] = useState<TargetType>(() => {
    return existingBroadcast?.target_type ?? "group";
  });
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() => {
    return existingBroadcast?.target_type === "group" ? existingBroadcast.target_ids ?? [] : [];
  });
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    return existingBroadcast?.target_type === "tag" ? existingBroadcast.target_ids ?? [] : [];
  });
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(() => {
    return existingBroadcast?.target_type === "manual" ? existingBroadcast.target_ids ?? [] : [];
  });

  // ---- Schedule ----
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(() => {
    return existingBroadcast?.status === "scheduled" ? "later" : "now";
  });
  const initialScheduleParsed = existingBroadcast?.scheduled_for
    ? parseScheduledDateTime(existingBroadcast.scheduled_for)
    : null;
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<Date | undefined>(
    () => initialScheduleParsed?.date ?? undefined
  );
  const [selectedHour, setSelectedHour] = useState<string>(() => {
    return initialScheduleParsed?.hour ?? getDefaultFutureTime().hour;
  });
  const [selectedMinute, setSelectedMinute] = useState<string>(() => {
    return initialScheduleParsed?.minute ?? getDefaultFutureTime().minute;
  });
  const [selectedPeriod, setSelectedPeriod] = useState<Period>(() => {
    return initialScheduleParsed?.period ?? getDefaultFutureTime().period;
  });
  const scheduledDate = combineDateAndTime(selectedScheduleDate, selectedHour, selectedMinute, selectedPeriod);

  // ---- Errors and saving ----
  const [messageError, setMessageError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSelectTemplate(templateId: string) {
    if (isReadOnly) return;
    setSelectedTemplateId(templateId);
    if (messageError) setMessageError(null);

    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setTemplateMode("template");
      setTemplateSourceBody(tmpl.body_text);
      const initialMappings = createDefaultMappings(extractPlaceholders(tmpl.body_text));
      setVariableMappings(initialMappings);
      setMessageText(computeResolvedMessage(tmpl.body_text, initialMappings));
    } else {
      setTemplateMode("custom");
      setTemplateSourceBody("");
      setVariableMappings({});
    }
  }

  /** Saves a changed mapping and refreshes the message preview. */
  function applyMapping(ph: string, next: VariableMapping, clearError = true) {
    const nextMappings = { ...variableMappings, [ph]: next };
    setVariableMappings(nextMappings);
    setMessageText(computeResolvedMessage(templateSourceBody, nextMappings));
    if (clearError && messageError) setMessageError(null);
  }

  function handleMappingTypeChange(ph: string, type: VariableMappingType) {
    if (isReadOnly) return;
    const current = variableMappings[ph];
    applyMapping(
      ph,
      type === "static"
        ? { type: "static", value: current && current.type === "static" ? current.value : "" }
        : {
            type: "contact_field",
            field: "first_name",
            fallback: current && current.type === "contact_field" ? current.fallback ?? "Investor" : "Investor",
          }
    );
  }

  function handleMappingFieldChange(ph: string, field: SupportedContactField) {
    if (isReadOnly) return;
    const current = variableMappings[ph];
    const fallback = current && current.type === "contact_field" ? current.fallback : "Investor";
    applyMapping(ph, { type: "contact_field", field, fallback });
  }

  function handleMappingFallbackChange(ph: string, fallback: string) {
    if (isReadOnly) return;
    const current = variableMappings[ph];
    if (current && current.type === "contact_field") {
      // Editing a fallback never cleared the message error.
      applyMapping(ph, { ...current, fallback }, false);
    }
  }

  function handleMappingStaticValueChange(ph: string, value: string) {
    if (isReadOnly) return;
    applyMapping(ph, { type: "static", value });
  }

  function handleClearTemplate() {
    setSelectedTemplateId("");
    setTemplateSourceBody("");
    setVariableMappings({});
    setTemplateMode("custom");
    if (messageError) setMessageError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReadOnly) return;

    setMessageError(null);
    setTargetError(null);
    setScheduleError(null);
    setError(null);

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage) {
      setMessageError("Message text is required.");
      return;
    }

    // If template mode is active with variables, validate that every placeholder has a valid mapping
    if (templateMode === "template" && detectedPlaceholders.length > 0) {
      for (const ph of detectedPlaceholders) {
        const mapping = variableMappings[ph];
        if (!mapping) {
          setMessageError(`Please configure variable mapping for {{${ph}}}.`);
          return;
        }
        if (mapping.type === "static") {
          if (!mapping.value || !mapping.value.trim()) {
            setMessageError(`Please enter a value for {{${ph}}} static text.`);
            return;
          }
        } else if (mapping.type === "contact_field") {
          if (!SUPPORTED_CONTACT_FIELDS.includes(mapping.field)) {
            setMessageError(`Please select a valid contact field for {{${ph}}}.`);
            return;
          }
        }
      }
    }

    let targetIds: string[] = [];
    if (targetType === "group") {
      if (selectedGroupIds.length === 0) {
        setTargetError("Please select at least one group.");
        return;
      }
      targetIds = selectedGroupIds;
    } else if (targetType === "tag") {
      if (selectedTags.length === 0) {
        setTargetError("Please select at least one tag.");
        return;
      }
      targetIds = selectedTags;
    } else if (targetType === "manual") {
      if (selectedContactIds.length === 0) {
        setTargetError("Please select at least one contact.");
        return;
      }
      targetIds = selectedContactIds;
    }

    if ((!isEditing && scheduleMode === "later") || isEditingScheduled) {
      if (!selectedScheduleDate) {
        setScheduleError("Scheduled date and time is required.");
        return;
      }
      if (!scheduledDate || isNaN(scheduledDate.getTime())) {
        setScheduleError("Please select a valid scheduled date and time.");
        return;
      }
      if (scheduledDate.getTime() <= new Date().getTime()) {
        setScheduleError("Scheduled time must be in the future.");
        return;
      }
      if (isMetaTemplate && !selectedTemplate?.approved_at) {
        setMessageError(
          "This template is not approved by Meta yet, so it can't be scheduled. Save it as a draft instead."
        );
        return;
      }
    }

    setSubmitting(true);
    let result: { success?: boolean; error?: string };

    const usingTemplate = templateMode === "template" && Boolean(selectedTemplateId);
    const templateIdPayload = usingTemplate ? selectedTemplateId : null;
    const variableMappingsPayload = usingTemplate ? variableMappings : {};

    if (isEditing && existingBroadcast) {
      result = await updateBroadcast(existingBroadcast.id, {
        message_text: trimmedMessage,
        target_type: targetType,
        target_ids: targetIds,
        ...(isEditingScheduled && scheduledDate ? { scheduled_for: scheduledDate.toISOString() } : {}),
        template_id: templateIdPayload,
        variable_mappings: variableMappingsPayload,
      });
    } else if (scheduleMode === "later") {
      if (!scheduledDate) {
        setScheduleError("Scheduled date and time is required.");
        setSubmitting(false);
        return;
      }
      result = await createScheduledBroadcast({
        message_text: trimmedMessage,
        target_type: targetType,
        target_ids: targetIds,
        scheduled_for: scheduledDate.toISOString(),
        template_id: templateIdPayload,
        variable_mappings: variableMappingsPayload,
      });
    } else {
      result = await createBroadcastDraft({
        message_text: trimmedMessage,
        target_type: targetType,
        target_ids: targetIds,
        template_id: templateIdPayload,
        variable_mappings: variableMappingsPayload,
      });
    }

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      toast(result.error, "error");
      return;
    }

    toast(
      isEditingScheduled
        ? "Scheduled broadcast updated successfully"
        : isEditing
        ? "Broadcast updated successfully"
        : scheduleMode === "later"
        ? "Broadcast scheduled successfully"
        : "Broadcast draft saved successfully"
    );

    router.push("/broadcasts");
    router.refresh();
  }

  const noTemplatesLabel = templates.length === 0 ? "No templates available" : "-- Use a Template (Optional) --";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {isReadOnly && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          {isSending
            ? "This broadcast is going out in batches and can't be edited. It finishes on its own within a few minutes."
            : "This broadcast has already been sent and cannot be edited."}
        </div>
      )}

      {/* Message Text Section */}
      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Message</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Compose custom message text or populate from a pre-defined WhatsApp template.
            </p>
          </div>
          {!isReadOnly && (
            <div className="flex items-center gap-2">
              <Select
                value={selectedTemplateId || "none"}
                disabled={templates.length === 0}
                onValueChange={(value) => {
                  handleSelectTemplate(value === "none" || !value ? "" : value);
                }}
              >
                <SelectTrigger className="h-8 w-[260px] max-w-xs text-xs font-medium" aria-label="Use Template">
                  <SelectValue placeholder={noTemplatesLabel}>
                    {/* Show the template's name, not its ID. */}
                    {(value: string | null) => templates.find((t) => t.id === value)?.name ?? noTemplatesLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{noTemplatesLabel}</SelectItem>
                  {templates.map((tmpl) => (
                    <SelectItem
                      key={tmpl.id}
                      value={tmpl.id}
                      // A Meta template can only be used once Meta has approved it.
                      disabled={Boolean(tmpl.meta_template_id && !tmpl.approved_at)}
                    >
                      {tmpl.name} ({tmpl.category || "General"})
                      {tmpl.meta_template_id
                        ? tmpl.approved_at
                          ? " ✓ Meta approved"
                          : " (Not approved by Meta yet)"
                        : tmpl.approved_at
                        ? " ✓"
                        : " (Draft)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplateId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearTemplate}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Template info banner if selected */}
        {selectedTemplate && (
          <div className="mt-3 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <span className="font-medium text-foreground">
                Loaded Template: <code className="font-mono text-primary font-semibold">{selectedTemplate.name}</code>
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase font-medium text-muted-foreground">
                {selectedTemplate.category || "Template"}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {detectedPlaceholders.length} variable{detectedPlaceholders.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {!isReadOnly && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isMetaTemplate && selectedTemplate
              ? selectedTemplate.approved_at
                ? "Meta-approved template: reaches contacts even if they haven't messaged you in the last 24 hours. It is sent exactly as approved; only the variables change per contact."
                : "This template isn't approved by Meta yet, so this broadcast can't be sent or scheduled. Choose another template, or wait for approval and click \"Sync from Meta\" on the Templates page."
              : `${selectedTemplate ? "CRM template" : "Custom message"}: sent as plain text, so only contacts who messaged you in the last 24 hours receive it. Everyone else is skipped and listed after sending; use an approved Meta template to reach them.`}
          </p>
        )}

        {selectedTemplate && detectedPlaceholders.length > 0 && (
          <VariableMappingsPanel
            placeholders={detectedPlaceholders}
            mappings={variableMappings}
            templateSamples={selectedTemplate.variables}
            disabled={isReadOnly}
            onTypeChange={handleMappingTypeChange}
            onFieldChange={handleMappingFieldChange}
            onFallbackChange={handleMappingFallbackChange}
            onStaticValueChange={handleMappingStaticValueChange}
          />
        )}

        {/* Message text field (Editable resolved message) */}
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="broadcast-message">Message text</Label>
            {selectedTemplate && (
              <span className="text-[11px] text-muted-foreground">
                {isMetaTemplate
                  ? "Preview only: Meta templates can't be edited here."
                  : "You can make additional custom edits directly below."}
              </span>
            )}
          </div>
          <Textarea
            id="broadcast-message"
            placeholder="Type your broadcast message here..."
            value={messageText}
            disabled={isReadOnly || isMetaTemplate}
            onChange={(e) => {
              setMessageText(e.target.value);
              if (messageError) setMessageError(null);
            }}
            rows={5}
            className="resize-y font-sans text-sm leading-relaxed"
          />
          {messageError && <p className="text-sm text-destructive">{messageError}</p>}
        </div>

        {/* WhatsApp-style Preview Bubble */}
        {messageText.trim() && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Eye className="size-3.5" />
                <span>Message Preview</span>
              </div>
              {selectedTemplate && detectedPlaceholders.length > 0 && (
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border/50">
                  Previewed with sample contact: <strong className="font-medium text-foreground">{SAMPLE_PREVIEW_CONTACT.name}</strong>
                </span>
              )}
            </div>
            <div className="inline-block max-w-lg rounded-xl rounded-tl-xs bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 shadow-xs text-sm leading-relaxed text-foreground whitespace-pre-wrap dark:bg-emerald-950/30">
              {messageText}
            </div>
          </div>
        )}
      </section>

      <AudiencePicker
        targetType={targetType}
        onTargetTypeChange={setTargetType}
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        onSelectedGroupIdsChange={setSelectedGroupIds}
        selectedTags={selectedTags}
        onSelectedTagsChange={setSelectedTags}
        contacts={contacts}
        sections={sections}
        selectedContactIds={selectedContactIds}
        onSelectedContactIdsChange={setSelectedContactIds}
        targetError={targetError}
        onEdit={() => setTargetError(null)}
        isReadOnly={isReadOnly}
      />

      {/* Scheduling Options Section */}
      {(!isEditing || isEditingScheduled || isSent) && (
        <section className="rounded-lg border bg-background p-5">
          <h2 className="text-base font-semibold">Scheduling</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {isSent
              ? "This broadcast was already sent."
              : isEditingScheduled
              ? "Modify the scheduled date and time when this broadcast will automatically be sent."
              : "Choose whether to save this as an immediate draft or schedule it for future dispatch."}
          </p>

          <div className="mt-4 flex flex-col gap-3">
            {isSent ? (
              <div className="text-sm text-muted-foreground">
                Sent at:{" "}
                <span className="font-medium text-foreground">
                  {existingBroadcast?.sent_at ? new Date(existingBroadcast.sent_at).toLocaleString() : "Unknown"}
                </span>
              </div>
            ) : (
              <>
                {!isEditing && (
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs sm:text-sm max-w-xs">
                    {(
                      [
                        { value: "now", label: "Send Now / Draft" },
                        { value: "later", label: "Schedule for later" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setScheduleMode(option.value);
                          setScheduleError(null);
                        }}
                        className={cn(
                          "cursor-pointer rounded-md py-1.5 font-medium transition-all",
                          scheduleMode === option.value
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}

                {(scheduleMode === "later" || isEditingScheduled) && (
                  <SchedulePicker
                    date={selectedScheduleDate}
                    onDateChange={setSelectedScheduleDate}
                    hour={selectedHour}
                    onHourChange={setSelectedHour}
                    minute={selectedMinute}
                    onMinuteChange={setSelectedMinute}
                    period={selectedPeriod}
                    onPeriodChange={setSelectedPeriod}
                    scheduledDate={scheduledDate}
                    scheduleError={scheduleError}
                    onEdit={() => {
                      if (scheduleError) setScheduleError(null);
                    }}
                    disabled={isReadOnly}
                  />
                )}
              </>
            )}
          </div>
        </section>
      )}

      {error && (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="outline" type="button" onClick={() => router.push("/broadcasts")}>
          {isReadOnly ? "Back to Broadcasts" : "Cancel"}
        </Button>
        {!isReadOnly && (
          <Button type="submit" disabled={submitting}>
            {submitting
              ? scheduleMode === "later" && !isEditing
                ? "Scheduling..."
                : "Saving..."
              : isEditing
              ? "Save Changes"
              : scheduleMode === "later"
              ? "Schedule Broadcast"
              : "Save Draft"}
          </Button>
        )}
      </div>
    </form>
  );
}

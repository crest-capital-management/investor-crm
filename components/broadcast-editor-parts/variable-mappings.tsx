"use client";

import { Variable } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  SupportedContactField,
  VariableMappings,
  VariableMappingType,
} from "@/lib/template-placeholders";

const MAPPING_SOURCE_LABELS: Record<string, string> = {
  first_name: "First Name",
  name: "Full Name",
  phone: "Phone",
  email: "Email",
  static: "Custom Text",
};

/** One row per template placeholder: where its value comes from (a contact field or custom text). */
export function VariableMappingsPanel({
  placeholders,
  mappings,
  templateSamples,
  disabled,
  onTypeChange,
  onFieldChange,
  onFallbackChange,
  onStaticValueChange,
}: {
  placeholders: string[];
  mappings: VariableMappings;
  /** Example values saved with the template, shown next to each placeholder. */
  templateSamples: Record<string, string> | null | undefined;
  disabled: boolean;
  onTypeChange: (ph: string, type: VariableMappingType) => void;
  onFieldChange: (ph: string, field: SupportedContactField) => void;
  onFallbackChange: (ph: string, fallback: string) => void;
  onStaticValueChange: (ph: string, value: string) => void;
}) {
  return (
    <div className="mt-4 rounded-md border bg-muted/20 p-3.5 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Variable className="size-3.5 text-muted-foreground" />
          <span>Variable Mappings</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Map variables to contact fields or custom text
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Configure how each placeholder will resolve for recipients. The preview below reflects these mappings against sample contact data.
      </p>

      <div className="mt-3 space-y-2.5">
        {placeholders.map((ph) => {
          const mapping = mappings[ph] ?? {
            type: "contact_field",
            field: "first_name",
            fallback: "Investor",
          };
          const sampleVal = templateSamples?.[ph];

          return (
            <div
              key={ph}
              className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/60 p-2.5 sm:flex-row sm:items-center sm:gap-3"
            >
              {/* Variable Tag & Template Sample */}
              <div className="flex items-center gap-2 sm:w-36 shrink-0">
                <span className="inline-flex items-center rounded bg-primary/10 px-2 py-1 font-mono text-xs font-semibold text-primary">
                  {`{{${ph}}}`}
                </span>
                {sampleVal && (
                  <span
                    className="text-[10px] text-muted-foreground truncate max-w-[80px]"
                    title={`Template sample: ${sampleVal}`}
                  >
                    ex: &quot;{sampleVal}&quot;
                  </span>
                )}
              </div>

              {/* Source Selector: Contact Field vs Custom Text */}
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={mapping.type === "static" ? "static" : mapping.field}
                  disabled={disabled}
                  onValueChange={(val) => {
                    if (!val) return;
                    if (val === "static") {
                      onTypeChange(ph, "static");
                    } else {
                      if (mapping.type !== "contact_field") {
                        onTypeChange(ph, "contact_field");
                      }
                      onFieldChange(ph, val as SupportedContactField);
                    }
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-[140px] text-xs font-medium"
                    aria-label={`Source for variable ${ph}`}
                  >
                    <SelectValue>
                      {(value: string) => MAPPING_SOURCE_LABELS[value] ?? value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Contact field</SelectLabel>
                      <SelectItem value="first_name">First Name</SelectItem>
                      <SelectItem value="name">Full Name</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Custom</SelectLabel>
                      <SelectItem value="static">Custom Text</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {/* Input field based on type */}
              <div className="flex-1 min-w-0">
                {mapping.type === "static" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      Value:
                    </span>
                    <Input
                      placeholder="Enter static text..."
                      value={mapping.value ?? ""}
                      disabled={disabled}
                      onChange={(e) => onStaticValueChange(ph, e.target.value)}
                      className="h-8 text-xs flex-1"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      Fallback:
                    </span>
                    <Input
                      placeholder="e.g. Investor"
                      value={mapping.fallback ?? ""}
                      disabled={disabled}
                      onChange={(e) => onFallbackChange(ph, e.target.value)}
                      className="h-8 text-xs flex-1"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

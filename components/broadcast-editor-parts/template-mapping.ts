import {
  fillPlaceholders,
  type SupportedContactField,
  type VariableMappings,
} from "@/lib/template-placeholders";

/** The made-up contact the broadcast preview is shown for. */
export const SAMPLE_PREVIEW_CONTACT: Record<SupportedContactField, string> = {
  first_name: "Rahul",
  name: "Rahul Sharma",
  phone: "+91 98765 43210",
  email: "rahul@example.com",
};

/**
 * A mapping for every placeholder: the saved one when it is valid, otherwise
 * the contact's first name with "Investor" as the fallback.
 */
export function createDefaultMappings(
  placeholders: string[],
  existing?: Record<string, unknown> | null
): VariableMappings {
  const mappings: VariableMappings = {};
  for (const ph of placeholders) {
    if (existing && existing[ph] && typeof existing[ph] === "object") {
      const raw = existing[ph] as Record<string, unknown>;
      if (raw.type === "static") {
        mappings[ph] = {
          type: "static",
          value: typeof raw.value === "string" ? raw.value : "",
        };
        continue;
      } else if (raw.type === "contact_field") {
        const field =
          raw.field === "name" ||
          raw.field === "phone" ||
          raw.field === "email"
            ? (raw.field as SupportedContactField)
            : "first_name";
        mappings[ph] = {
          type: "contact_field",
          field,
          fallback:
            typeof raw.fallback === "string" ? raw.fallback : "Investor",
        };
        continue;
      }
    }
    mappings[ph] = {
      type: "contact_field",
      field: "first_name",
      fallback: "Investor",
    };
  }
  return mappings;
}

/** The message as the sample contact would receive it; unmapped placeholders stay visible. */
export function computeResolvedMessage(body: string, mappings: VariableMappings): string {
  return fillPlaceholders(body, (ph) => {
    const mapping = mappings[ph];
    if (!mapping) return undefined;
    if (mapping.type === "static") return mapping.value || undefined;
    return SAMPLE_PREVIEW_CONTACT[mapping.field] || mapping.fallback || undefined;
  });
}

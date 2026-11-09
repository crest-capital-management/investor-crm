/**
 * WhatsApp template placeholders ({{1}}, {{2}}, ...) and the broadcast
 * variable mappings that fill them. Pure functions, safe in the browser and
 * on the server.
 */

const PLACEHOLDER_PATTERN = /\{\{(\d+)\}\}/g;

/** The distinct placeholder numbers in `text`, in numeric order: ["1", "2", ...]. */
export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) found.add(match[1]);
  return Array.from(found).sort((a, b) => Number(a) - Number(b));
}

/**
 * Replaces each {{N}} in `text` with `valueFor("N")`. A placeholder whose value
 * is undefined is left as it is. One pass, so a value that itself looks like
 * a placeholder is never substituted again.
 */
export function fillPlaceholders(text: string, valueFor: (placeholder: string) => string | undefined): string {
  return text.replace(PLACEHOLDER_PATTERN, (whole, placeholder: string) => valueFor(placeholder) ?? whole);
}

/** Contact fields a broadcast placeholder can be filled from. */
export type SupportedContactField = "first_name" | "name" | "phone" | "email";

export const SUPPORTED_CONTACT_FIELDS: readonly SupportedContactField[] = ["first_name", "name", "phone", "email"];

export interface ContactFieldMapping {
  type: "contact_field";
  field: SupportedContactField;
  fallback?: string;
}

export interface StaticMapping {
  type: "static";
  value: string;
}

export type VariableMapping = ContactFieldMapping | StaticMapping;
export type VariableMappingType = VariableMapping["type"];
export type VariableMappings = Record<string, VariableMapping>;

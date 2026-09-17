"use server";

import { revalidatePath } from "next/cache";
import { requireActionAuth } from "@/lib/auth";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface TemplateData {
  id: string;
  name: string;
  meta_template_id?: string | null;
  variables: Record<string, string>;
  category: TemplateCategory | string | null;
  body_text: string;
  approved_at?: string | null;
  created_at: string;
  deleted_at?: string | null;
}

export interface CreateTemplateInput {
  name: string;
  category: TemplateCategory;
  body_text: string;
  variables: Record<string, string>;
}

export interface UpdateTemplateInput {
  name: string;
  category: TemplateCategory;
  body_text: string;
  variables: Record<string, string>;
}

const TEMPLATE_NAME_REGEX = /^[a-z0-9_]+$/;

function validateTemplateInput(data: {
  name: string;
  category: string;
  body_text: string;
}): string | null {
  const name = (data.name ?? "").trim();
  if (!name) {
    return "Template name is required.";
  }

  if (!TEMPLATE_NAME_REGEX.test(name)) {
    return "Template name must contain only lowercase letters, numbers, and underscores (e.g. quarterly_update_2026).";
  }

  if (name.length > 512) {
    return "Template name must be 512 characters or fewer.";
  }

  const validCategories: TemplateCategory[] = [
    "MARKETING",
    "UTILITY",
    "AUTHENTICATION",
  ];
  if (!validCategories.includes(data.category as TemplateCategory)) {
    return "Please select a valid category (MARKETING, UTILITY, or AUTHENTICATION).";
  }

  const bodyText = (data.body_text ?? "").trim();
  if (!bodyText) {
    return "Body text is required.";
  }

  return null;
}

export async function createTemplate(data: CreateTemplateInput) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  const validationError = validateTemplateInput(data);
  if (validationError) {
    return { error: validationError };
  }

  const normalizedName = data.name.trim().toLowerCase();
  const normalizedBody = data.body_text.trim();
  const variables = data.variables && typeof data.variables === "object" ? data.variables : {};

  const { data: inserted, error } = await supabase
    .from("templates")
    .insert({
      name: normalizedName,
      category: data.category,
      body_text: normalizedBody,
      variables,
      meta_template_id: null,
      approved_at: null,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message || "Failed to create template." };
  }

  revalidatePath("/templates");
  return { success: true, id: inserted.id };
}

export async function updateTemplate(id: string, data: UpdateTemplateInput) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  if (!id) {
    return { error: "Template ID is required." };
  }

  const validationError = validateTemplateInput(data);
  if (validationError) {
    return { error: validationError };
  }

  const normalizedName = data.name.trim().toLowerCase();
  const normalizedBody = data.body_text.trim();
  const variables = data.variables && typeof data.variables === "object" ? data.variables : {};

  // Verify template exists and is not deleted
  const { data: existing, error: fetchError } = await supabase
    .from("templates")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !existing) {
    return { error: "Template not found." };
  }

  const { error } = await supabase
    .from("templates")
    .update({
      name: normalizedName,
      category: data.category,
      body_text: normalizedBody,
      variables,
    })
    .eq("id", id);

  if (error) {
    return { error: error.message || "Failed to update template." };
  }

  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
  return { success: true };
}

export async function deleteTemplate(id: string) {
  const { supabase, error: authError } = await requireActionAuth();
  if (authError || !supabase) {
    return { error: "Unauthorized" };
  }

  if (!id) {
    return { error: "Template ID is required." };
  }

  const { error } = await supabase
    .from("templates")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { error: error.message || "Failed to delete template." };
  }

  revalidatePath("/templates");
  return { success: true };
}

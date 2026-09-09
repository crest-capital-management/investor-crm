"use server";

import { createClient } from "@/src/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addContact(formData: FormData) {
  const name = formData.get("name") as string;
  const phone = formData.get("phone") as string;
  const tagsRaw = formData.get("tags") as string;
  const dateSaved = formData.get("dateSaved") as string;

  let tags: string[] = [];
  try {
    tags = tagsRaw ? JSON.parse(tagsRaw) : [];
  } catch {
    tags = [];
  }

  if (!name || !phone) {
    return { error: "Name and phone are required." };
  }

  if (!dateSaved) {
    return { error: "Date is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .insert({ name, phone, tags, date_saved: dateSaved });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/contacts");
  return { success: true };
}

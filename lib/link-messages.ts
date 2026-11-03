import { db } from "@/lib/db";
import { normalizeToLocalPhone } from "@/lib/whatsapp";

/**
 * Links WhatsApp messages that arrived from a number before it was saved as
 * a contact (contact_id = null) to the contact that now has that number.
 * Never throws: a failure here must not break adding or importing contacts.
 */
export async function linkUnmatchedMessages(
  contacts: Array<{ id: string; phone: string | null }>,
): Promise<void> {
  try {
    const idByPhone = new Map<string, string>();
    for (const contact of contacts) {
      const phone = normalizeToLocalPhone(contact.phone ?? "");
      if (phone) idByPhone.set(phone, contact.id);
    }
    const phones = [...idByPhone.keys()];

    for (let i = 0; i < phones.length; i += 200) {
      const data = await db.query<{ phone: string }>(
        "select phone from whatsapp_messages where contact_id is null and phone = any($1::text[])",
        [phones.slice(i, i + 200)],
      );

      for (const phone of new Set(data.map((row) => row.phone))) {
        await db.execute(
          "update whatsapp_messages set contact_id = $1 where contact_id is null and phone = $2",
          [idByPhone.get(phone), phone],
        );
      }
    }
  } catch (err) {
    console.error("[link-messages] Could not link earlier WhatsApp messages:", err);
  }
}

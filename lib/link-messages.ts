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
    const entries = [...idByPhone.entries()];

    // One statement per batch: each unmatched message gets the id of the contact with its phone.
    for (let i = 0; i < entries.length; i += 200) {
      const batch = entries.slice(i, i + 200);
      await db.execute(
        `update whatsapp_messages m
            set contact_id = x.id
           from unnest($1::text[], $2::uuid[]) as x(phone, id)
          where m.contact_id is null and m.phone = x.phone`,
        [batch.map(([phone]) => phone), batch.map(([, id]) => id)],
      );
    }
  } catch (err) {
    console.error("[link-messages] Could not link earlier WhatsApp messages:", err);
  }
}

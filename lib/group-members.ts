export type ContactSummary = {
  id: string;
  name: string;
  phone: string;
};

export type GroupContactRelation = {
  contact_id: string;
  contacts: ContactSummary | ContactSummary[] | null;
};

export type GroupMember = {
  contact_id: string;
  contact: ContactSummary | null;
};

export function normalizeGroupMembers(
  relations: GroupContactRelation[] | null | undefined,
): GroupMember[] {
  return (relations ?? []).map(({ contact_id, contacts }) => ({
    contact_id,
    contact: Array.isArray(contacts) ? contacts[0] ?? null : contacts,
  }));
}

import { createClient } from "@/src/lib/supabase/server";
import { AddContactDialog } from "@/components/add-contact-dialog";

export default async function ContactsPage() {
  const supabase = await createClient();
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, name, phone, tags, date_saved")
    .order("date_saved", { ascending: false });

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="mt-2 text-destructive">Error loading contacts: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <AddContactDialog />
      </div>
      <table className="mt-4 w-full max-w-2xl border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Phone</th>
            <th className="py-2 pr-4">Tags</th>
            <th className="py-2 pr-4">Date Added</th>
          </tr>
        </thead>
        <tbody>
          {contacts?.length ? (
            contacts.map((contact) => (
              <tr key={contact.id} className="border-b">
                <td className="py-2 pr-4">{contact.name}</td>
                <td className="py-2 pr-4">{contact.phone}</td>
                <td className="py-2 pr-4">
                  {contact.tags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="mr-1 mb-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {new Date(contact.date_saved).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="py-4 text-muted-foreground">
                No contacts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

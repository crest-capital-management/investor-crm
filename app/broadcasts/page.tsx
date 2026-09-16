import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth";
import { CreateBroadcastSheet, type BroadcastData } from "@/components/create-broadcast-sheet";
import { BroadcastsTable } from "@/components/broadcasts-table";

export const metadata: Metadata = {
  title: "Broadcasts",
};

export default async function BroadcastsPage() {
  const { supabase } = await requireAuth();

  const [broadcastsResult, groupsResult, contactsResult] = await Promise.all([
    supabase
      .from("broadcasts")
      .select(
        "id, message_text, target_type, target_ids, status, scheduled_for, sent_at, created_at"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("groups")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, name, phone")
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  ]);

  if (broadcastsResult.error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Broadcasts</h1>
        <p className="mt-2 text-destructive">Unable to load broadcasts.</p>
      </div>
    );
  }

  const broadcasts = (broadcastsResult.data ?? []) as BroadcastData[];
  const groups = (groupsResult.data ?? []) as { id: string; name: string }[];
  const contacts = (contactsResult.data ?? []) as {
    id: string;
    name: string;
    phone: string;
  }[];

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose and track message broadcasts.
          </p>
        </div>
        <CreateBroadcastSheet groups={groups} contacts={contacts} />
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <BroadcastsTable
          broadcasts={broadcasts}
          groups={groups}
          contacts={contacts}
        />
      </div>
    </div>
  );
}

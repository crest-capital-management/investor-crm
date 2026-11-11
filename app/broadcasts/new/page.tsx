import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthFast } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadBroadcastContactChoices } from "@/lib/sections";
import { BroadcastEditor } from "@/components/broadcast-editor";
import type {
  GroupOption,
  TemplateOption,
} from "@/app/broadcasts/actions";

export const metadata: Metadata = {
  title: "New Broadcast",
};

export default async function NewBroadcastPage() {
  await requireAuthFast();

  // A failed lookup leaves that picker empty, as before.
  const [groups, contactChoices, templates] = await Promise.all([
    db.query<GroupOption>("select id, name from groups order by name asc").catch(() => []),
    loadBroadcastContactChoices(),
    db
      .query<TemplateOption>(
        `select id, name, category, body_text, variables, approved_at, meta_template_id
           from templates
          where deleted_at is null
          order by name asc`,
      )
      .catch(() => []),
  ]);

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3">
        <div>
          <Link
            href="/broadcasts"
            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Broadcasts
          </Link>
          <h1 className="text-2xl font-semibold">New Broadcast</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose a broadcast message and select recipient targets.
          </p>
        </div>
      </div>

      <div className="mt-6 max-w-4xl">
        <BroadcastEditor
          mode="create"
          groups={groups}
          contacts={contactChoices.contacts}
          sections={contactChoices.sections}
          templates={templates}
        />
      </div>
    </div>
  );
}

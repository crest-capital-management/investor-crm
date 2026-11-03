import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthFast } from "@/lib/auth";
import type { TemplateData } from "@/app/templates/actions";
import { PaginationControls } from "@/components/pagination-controls";
import { TemplatesTable } from "@/components/templates-table";
import { SyncMetaTemplatesButton } from "@/components/sync-meta-templates-button";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { PAGE_SIZE, getTotalPages, parsePage } from "@/lib/pagination";
import { pageClause } from "@/lib/sql";

export const metadata: Metadata = {
  title: "Templates",
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const requestedPage = parsePage((await searchParams).page);
  await requireAuthFast();

  let totalCount: number;
  let page: number;
  let templates: TemplateData[];
  try {
    const { count } = await db.one<{ count: number }>(
      `select count(*)::int as count from public.templates where deleted_at is null`,
    );
    totalCount = count;
    // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
    page = Math.min(requestedPage, getTotalPages(totalCount));

    const params: unknown[] = [];
    templates = await db.query<TemplateData>(
      `select id, name, meta_template_id, variables, category, body_text, approved_at, created_at
       from public.templates
       where deleted_at is null
       order by created_at desc, id asc
       ${pageClause(params, page, PAGE_SIZE)}`,
      params,
    );
  } catch {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="mt-2 text-destructive">Unable to load templates.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, view, and manage WhatsApp message templates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncMetaTemplatesButton />
          <Link href="/templates/new">
            <Button className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm">
              + New Template
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <TemplatesTable key={page} templates={templates} />
        <PaginationControls page={page} totalCount={totalCount} itemLabel="templates" />
      </div>
    </div>
  );
}

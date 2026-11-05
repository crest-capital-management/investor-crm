import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthFast } from "@/lib/auth";
import { db } from "@/lib/db";
import type { BroadcastData } from "@/app/broadcasts/actions";
import { BroadcastsTable } from "@/components/broadcasts-table";
import { PaginationControls } from "@/components/pagination-controls";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE, getTotalPages, parsePage } from "@/lib/pagination";
import { pageClause } from "@/lib/sql";

export const metadata: Metadata = {
  title: "Broadcasts",
};

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const requestedPage = parsePage((await searchParams).page);
  await requireAuthFast();

  let broadcasts: BroadcastData[];
  let totalCount: number;
  let page: number;
  try {
    const counted = await db.one<{ n: number }>(
      "select count(*)::int as n from broadcasts where deleted_at is null",
    );
    totalCount = counted.n;
    // Clamp so a stale or hand-typed ?page=999 shows the last page instead of erroring.
    page = Math.min(requestedPage, getTotalPages(totalCount));
    const params: unknown[] = [];
    broadcasts = await db.query<BroadcastData>(
      `select * from broadcasts
        where deleted_at is null
        order by created_at desc, id asc
        ${pageClause(params, page, PAGE_SIZE)}`,
      params,
    );
  } catch {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold">Broadcasts</h1>
        <p className="mt-2 text-destructive">Unable to load broadcasts.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose and track message broadcasts.
          </p>
        </div>
        <Link href="/broadcasts/new">
          <Button className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm">
            + New Broadcast
          </Button>
        </Link>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <BroadcastsTable key={page} broadcasts={broadcasts} />
        <PaginationControls page={page} totalCount={totalCount} itemLabel="broadcasts" />
      </div>
    </div>
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { db } from "@/lib/db";
import { isOwnerId } from "@/lib/auth";
import { createSignedPortfolioUrl } from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";

/** Downloads the original file of a portfolio update (signed-in owner only). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwnerId(user.id)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only the CRM owner gets here (checked above). A malformed id simply finds no update.
  let update: { file_path: string; file_name: string } | null = null;
  try {
    update = await db.maybeOne<{ file_path: string; file_name: string }>(
      "select file_path, file_name from portfolio_updates where id::text = $1 and deleted_at is null",
      [id],
    );
  } catch {
    update = null;
  }
  if (!update) return new NextResponse("Update not found.", { status: 404 });

  const signed = await createSignedPortfolioUrl(update.file_path, update.file_name);
  if (!signed) return new NextResponse("The file could not be opened.", { status: 404 });
  return NextResponse.redirect(signed);
}

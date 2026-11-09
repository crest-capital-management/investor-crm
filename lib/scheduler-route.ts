import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/secure-compare";

/**
 * A POST handler for a scheduled job, called by the server's cron job with
 * `Authorization: Bearer <SCHEDULER_SECRET>`. A missing secret or a wrong
 * token gets the same generic 401. `run` returns the JSON body on success;
 * an error becomes a 500 with its message (or `failureMessage`).
 */
export function schedulerRoute(run: () => Promise<object>, failureMessage: string) {
  return async function POST(request: Request) {
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.SCHEDULER_SECRET;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7).trim();
    if (!expectedSecret || !safeEqual(token, expectedSecret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      return NextResponse.json(await run());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : failureMessage;
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

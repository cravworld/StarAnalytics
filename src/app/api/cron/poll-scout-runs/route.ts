// Polling cron for Scoutline — see src/lib/data/scout.ts's module doc for why this has to be
// async at all (a route killed mid-wait orphans a billed, unread Apify run). Same
// CRON_SECRET-auth, fail-closed pattern as every other cron in this codebase.
import { NextResponse } from "next/server";
import { pollAndIngestScoutRuns } from "@/lib/data/scout";

// A deep scan (many posts/account) shrinks chunk size (see scout.ts's computeChunkSize),
// which means more, smaller runs can land in the same polling tick — each with its own
// per-item ingest work. 60s was fine at the original 15-post default; give real headroom
// now that a tick can plausibly ingest several dozen chunks' worth of candidates at once.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pollAndIngestScoutRuns();
  return NextResponse.json(result);
}

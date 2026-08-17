// Manual entry — type in one or a few Instagram links/handles and scan them directly,
// without a file. Same batch/run pipeline as the upload route, just a different parser
// and a different sourceType label ("manual") so the batch list can tell them apart.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createScoutBatch, startScoutRuns } from "@/lib/data/scout";
import { parseInfluencerManualText } from "@/lib/scout/ingest";

export const maxDuration = 120; // backstop only — the real fix was bulk DB writes + parallel Apify run-starts (scout.ts), not a longer window

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { text } = await request.json();
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "no links provided" }, { status: 400 });
  }

  const result = parseInfluencerManualText(text);
  if (result.candidates.length === 0) {
    return NextResponse.json({ error: "no valid Instagram handles/links found in that text" }, { status: 422 });
  }

  const label = result.candidates.length === 1 ? `@${result.candidates[0].handle}` : `${result.candidates.length} accounts`;
  const batch = await createScoutBatch(`Quick scan — ${label}`, "manual", result.rowsFound, result.candidates);
  const { runsStarted, runsFailed } = await startScoutRuns(batch.batchId);

  return NextResponse.json({
    batchId: batch.batchId,
    expectedCount: batch.expectedCount,
    parsedCount: batch.parsedCount,
    runsStarted,
    runsFailed,
  });
}

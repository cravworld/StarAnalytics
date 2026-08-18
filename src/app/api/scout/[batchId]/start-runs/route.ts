// Separate from /api/scout/upload deliberately (2026-08-18) — upload only parses + persists
// the batch and reports how many of its accounts were already scanned recently
// (getScoutBatchFreshness); this route is the one that actually spends Apify credits. Split
// so the upload UI can show a "N accounts already scanned this week — scan again or skip?"
// confirmation before any run starts, instead of always re-scanning everyone unconditionally.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getScoutBatchFreshness, startScoutRuns } from "@/lib/data/scout";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { batchId } = await params;
  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === "new-only" ? "new-only" : "all";

  // Recomputed server-side, not trusted from the client — the confirmation dialog shows a
  // count from the upload response, but which specific candidateIds count as "already fresh"
  // is decided here, at the moment credits actually get spent.
  let onlyCandidateIds: string[] | undefined;
  if (mode === "new-only") {
    const freshness = await getScoutBatchFreshness(batchId);
    onlyCandidateIds = freshness.needsScanCandidateIds;
  }

  const { runsStarted, runsFailed } = await startScoutRuns(batchId, onlyCandidateIds ? { onlyCandidateIds } : undefined);
  return NextResponse.json({ runsStarted, runsFailed, mode });
}

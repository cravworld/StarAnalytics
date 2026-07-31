// Chunked, re-invokable backfill for per-comment sentiment classification — mirrors
// backfill-sentiment/route.ts's pattern (CRON_SECRET-auth, fail-closed, bounded chunk per
// call). Registered in vercel.json as a real recurring cron now that the project is on
// Vercel Pro (Hobby's once/day cap made that unsafe before — see poll-hashtags/route.ts).
//
// Not source-filtered: operates directly on PostComment rows, so it needs no knowledge of
// which post (campaign/agency/competitor/fanpage/self) a comment belongs to — once comment
// scraping is widened beyond campaign/agency posts, new rows from any source just show up
// here automatically.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifyCommentsForSentiment } from "@/lib/data/commentSentiment";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "backfill-comment-sentiment";

// Bounded per invocation so one call can't run indefinitely, same reasoning as
// backfill-sentiment's CHUNK_SIZE — sized higher (5000 vs. 100) since each unit of work
// here is one short comment through a 50-per-batch classifier (not a caption+20-comments
// blend), and batches now run BATCH_CONCURRENCY-wide concurrently (see
// commentSentiment.ts) rather than one at a time, so more fits in the same wall-clock time.
const CHUNK_SIZE = 5000;

// Pro's generally-available ceiling is 800s; this uses the extended 1800s (30 min) tier,
// available on Pro/Enterprise in beta at time of writing (2026-07-31, confirmed against
// Vercel's own docs) via the same per-route maxDuration export already used here — no
// extra config needed to opt in. Deliberately the longer ceiling specifically for this
// route (not poll-hashtags, which fires every 15 min): this one only runs on manual/cron
// re-invocation to grind a backlog, so an occasional long run doesn't risk piling up
// overlapping invocations the way a frequent job would.
export const maxDuration = 1800;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // This is the tightest cadence of the three cron routes (see vercel.json) — most likely
  // of all of them to have a still-running previous invocation when the next tick fires.
  // Skip rather than overlap: two concurrent runs would both pull the same unclassified
  // comments before either writes results, doubling Claude calls for zero extra
  // throughput. TTL matches maxDuration + a buffer so a killed invocation self-recovers.
  if (!(await tryAcquireCronLock(LOCK_NAME, 1800 + 60))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    const candidates = await prisma.postComment.findMany({
      where: { text: { not: null }, sentiment: null },
      select: { id: true },
      take: CHUNK_SIZE,
    });

    if (candidates.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0, message: "nothing to backfill" });
    }

    const commentIds = candidates.map((c) => c.id);
    try {
      const { classified, failedBatches } = await classifyCommentsForSentiment(commentIds);
      return NextResponse.json({
        candidates: commentIds.length,
        classified,
        failedBatches,
        chunkSize: CHUNK_SIZE,
      });
    } catch (err) {
      return NextResponse.json(
        { classified: 0, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}

// Re-runnable backfill for posts lacking sentiment classification — originally scoped to
// campaign/agency posts only (AGENTS.md Phase 4 §B3), widened to every post source below.
// Modeled on poll-hashtags (CRON_SECRET-auth, fail-closed), not on the NODE_ENV-gated
// /api/dev/* pattern: this must reach real posts in production, which a dev-only route
// never can. Safely re-runnable — classifyPostsForSentiment's own staleness filter means
// calling this repeatedly just processes whatever's left, with zero redundant Claude calls
// on posts already classified within the staleness window.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifyPostsForSentiment } from "@/lib/data/sentiment";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "backfill-sentiment";

// Bounded per invocation so one call can't run indefinitely — re-invoke (cron, or a loop of
// curl calls) to work through a large backlog. Raised from 100: batches inside
// classifyPostsForSentiment now run concurrently (see sentiment.ts), and the extended
// maxDuration below gives more wall-clock per invocation to spend it in.
const CHUNK_SIZE = 300;
const STALENESS_HOURS = 24;

// Extended Pro/Enterprise tier (1800s, beta as of 2026-07-31 — see
// backfill-comment-sentiment/route.ts for the same reasoning). Needed here specifically
// because a candidate post lacking comments triggers a live Apify comment-scrape
// (scrapeCommentsForPosts) as a side effect, and COMMENTS_PER_POST_LIMIT is now 100,000 —
// that scrape's own runtime is a real, external variable this route has no control over.
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

  // Cadence is short enough now (see vercel.json) that a slow run — e.g. one that hits a
  // live Apify comment-scrape for a post with a large comment count — can still be going
  // when the next tick fires. Skip rather than overlap: two concurrent runs would both pull
  // the same "needs classification" candidates before either writes results, doubling
  // Claude/Apify calls for zero extra throughput. TTL matches maxDuration + a buffer so a
  // killed invocation self-recovers.
  if (!(await tryAcquireCronLock(LOCK_NAME, 1800 + 60))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    // Previously scoped to source: {in: ["campaign", "agency"]} — widened to every post
    // source (competitor/fanpage/self included) because the product now wants comment
    // scraping + classification to reach every tracked post, not just campaign/agency ones.
    // This is also what triggers scrapeCommentsForPosts (see classifyPostsForSentiment) for
    // sources that never had comments scraped at all before this change.
    const staleCutoff = new Date(Date.now() - STALENESS_HOURS * 60 * 60 * 1000);
    const candidates = await prisma.post.findMany({
      where: {
        OR: [{ sentiment: null }, { sentiment: { analyzedAt: { lt: staleCutoff } } }],
      },
      select: { id: true },
      take: CHUNK_SIZE,
    });

    if (candidates.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0, message: "nothing to backfill" });
    }

    const postIds = candidates.map((p) => p.id);
    try {
      await classifyPostsForSentiment(postIds);
    } catch (err) {
      return NextResponse.json(
        { processed: 0, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }

    return NextResponse.json({ processed: postIds.length, chunkSize: CHUNK_SIZE });
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}

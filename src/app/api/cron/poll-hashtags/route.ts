// Polling cron (see vercel.json) — re-scrapes every currently-tracked hashtag and
// appends a fresh hashtag_snapshots row. Per the build plan: polling, not WebSocket/
// real-time push, for hashtag volume. The live post *stream* on a campaign detail
// page is separate — that's Supabase Realtime on `posts` inserts.
//
// Designed for a 15-min cadence; was scheduled once/day because Vercel's Hobby plan
// caps crons at once/day (every production deploy had been silently failing —
// deploy_failed — as a result, production stuck 9 commits behind main until found and
// fixed). Now on Vercel Pro (confirmed 2026-07-31 by a production deploy accepting this
// exact schedule, which Hobby would reject at deploy time) — restored to */15 in
// vercel.json.
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { trackHashtag } from "@/lib/data/campaigns";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { refreshStaleCompetitors } from "@/lib/data/compare";
import { refreshStaleFanPages } from "@/lib/data/fanpages";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "poll-hashtags";

// The comment-scrape + classify pipeline queued below now runs inside this route's lifetime
// (via after()) — give it room. Once the sentiment staleness cache is warm, steady-state
// cron cycles only touch genuinely-new posts, so this stays well under the ceiling in
// practice. Raised to Pro's generally-available ceiling (800s, not the 1800s extended/beta
// tier used by the backfill routes) — this one fires automatically every 15 minutes, so a
// long-running invocation matters more here than on a manually-triggered backfill;
// COMMENTS_PER_POST_LIMIT is now 100,000, so a newly-touched viral post could plausibly
// trigger a genuinely slow Apify comment-scrape as a side effect of queueSentimentClassification.
export const maxDuration = 800;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never mean "no auth required" — this
    // endpoint triggers metered Apify scrapes and its path is predictable.
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cadence is now short enough (*/5, see vercel.json) that a slow tick can still be running
  // when the next one fires. Skip rather than overlap — a duplicate poll of the same
  // hashtag mid-run wastes an Apify call for zero extra freshness, not a correctness issue,
  // but it's still pure waste. TTL matches maxDuration + a buffer so a killed invocation
  // self-recovers instead of wedging every future tick.
  if (!(await tryAcquireCronLock(LOCK_NAME, 800 + 60))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    const tracked = await prisma.hashtagSnapshot.groupBy({ by: ["hashtag"] });
    const results: { hashtag: string; ok: boolean; error?: string }[] = [];
    const touchedPostIds: string[] = [];

    for (const { hashtag } of tracked) {
      try {
        touchedPostIds.push(...(await trackHashtag(hashtag)));
        results.push({ hashtag, ok: true });
      } catch (err) {
        // One hashtag failing (rate limit, actor error) shouldn't block the rest of
        // the poll cycle — log and move on rather than aborting the whole run.
        results.push({ hashtag, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Queued after the response is sent — new/refreshed posts get comment-scrape + sentiment
    // classification without a manual trigger (see AGENTS.md Phase 4 §B3). Lock is released
    // before this fires (see finally below), same reasoning as the module doc comment:
    // queueSentimentClassification has its own internal dedup, so it's safe to let it run
    // unguarded by this lock.
    if (touchedPostIds.length > 0) {
      after(() => queueSentimentClassification(touchedPostIds));
    }

    // Same heartbeat also refreshes any tracked /compare competitor whose data has aged
    // past its TTL — this is the only background refresh path (see src/lib/data/compare.ts),
    // so it stays TTL-gated rather than re-scraping every cycle.
    const competitorResults = await refreshStaleCompetitors();

    // And any YouTube fan channel past its TTL — Instagram fan pages don't need this (they
    // update passively via the hashtag scrape above), but YouTube has no such pipeline to
    // piggyback on (see fanpages.ts's refreshStaleFanPages).
    const fanPageResults = await refreshStaleFanPages();

    return NextResponse.json({
      polled: results.length,
      results,
      competitorsRefreshed: competitorResults,
      fanPagesRefreshed: fanPageResults,
    });
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}

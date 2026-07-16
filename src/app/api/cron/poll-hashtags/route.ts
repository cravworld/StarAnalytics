// Polling cron (see vercel.json) — re-scrapes every currently-tracked hashtag and
// appends a fresh hashtag_snapshots row. Per the build plan: polling, not WebSocket/
// real-time push, for hashtag volume. The live post *stream* on a campaign detail
// page is separate — that's Supabase Realtime on `posts` inserts.
//
// Designed for a 15-min cadence, but currently scheduled once/day in vercel.json:
// Vercel's Hobby plan caps crons at once/day, and every production deploy since this
// cron was added had been silently failing (deploy_failed) as a result — production
// was stuck 9 commits behind main until this was found and fixed. Move back to */15
// once the project is on a Pro plan (or the cron is moved to an external scheduler).
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { trackHashtag } from "@/lib/data/campaigns";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { refreshStaleCompetitors } from "@/lib/data/compare";

// The comment-scrape + classify pipeline queued below now runs inside this route's lifetime
// (via after()) — give it room. Once the sentiment staleness cache is warm, steady-state
// cron cycles only touch genuinely-new posts, so this stays well under the ceiling in practice.
export const maxDuration = 300;

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
  // classification without a manual trigger (see AGENTS.md Phase 4 §B3).
  if (touchedPostIds.length > 0) {
    after(() => queueSentimentClassification(touchedPostIds));
  }

  // Same 15-minute heartbeat also refreshes any tracked /compare competitor whose data
  // has aged past its TTL — this is the only background refresh path (see
  // src/lib/data/compare.ts), so it stays TTL-gated rather than re-scraping every cycle.
  const competitorResults = await refreshStaleCompetitors();

  return NextResponse.json({ polled: results.length, results, competitorsRefreshed: competitorResults });
}

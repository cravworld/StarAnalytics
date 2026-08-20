// Polling cron (see vercel.json) — re-scrapes every currently-tracked hashtag and
// appends a fresh hashtag_snapshots row. Per the build plan: polling, not WebSocket/
// real-time push, for hashtag volume. The live post *stream* on a campaign detail
// page is separate — that's Supabase Realtime on `posts` inserts.
//
// Was scheduled once/day because Vercel's Hobby plan caps crons at once/day (every
// production deploy had been silently failing — deploy_failed — as a result, production
// stuck 9 commits behind main until found and fixed). Now on Vercel Pro (confirmed
// 2026-07-31 by a production deploy accepting a sub-daily schedule, which Hobby would
// reject at deploy time).
//
// The actual schedule is HOURLY (`0 * * * *`, see vercel.json) — earlier comments here
// claimed */15 and */5, neither of which was ever deployed. The distinction matters for
// money, not just accuracy: at APIFY_HASHTAG_RESULTS_LIMIT=150 and $0.0023/result, each
// tracked hashtag costs $0.345 per tick, so hourly is ~$248/month per hashtag against a
// $29 plan. QUOTA_COOLDOWN_MS (55 min) is also tuned to this exact cadence — changing one
// without the other silently halves the breaker's probe rate. See APIFY-USAGE-AUDIT.md §I.
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { trackHashtag } from "@/lib/data/campaigns";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { refreshStaleCompetitors } from "@/lib/data/compare";
import { refreshStaleFanPages } from "@/lib/data/fanpages";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";
import { isApifyQuotaFailure } from "@/lib/apify/quotaBreaker";

const LOCK_NAME = "poll-hashtags";

// The comment-scrape + classify pipeline queued below now runs inside this route's lifetime
// (via after()) — give it room. Once the sentiment staleness cache is warm, steady-state
// cron cycles only touch genuinely-new posts, so this stays well under the ceiling in
// practice. Raised to Pro's generally-available ceiling (800s, not the 1800s extended/beta
// tier used by the backfill routes) — this one fires automatically every 15 minutes, so a
// long-running invocation matters more here than on a manually-triggered backfill;
// a newly-touched viral post's comment thread can still make a genuinely slow Apify
// comment-scrape as a side effect of queueSentimentClassification, even under the
// bounded COMMENTS_PER_POST_LIMIT (see apify-public-content.ts).
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

  // A slow tick can still be running when the next one fires (an hour is not much when a
  // tick scrapes several hashtags and then comment-scrapes what it touched). Skip rather
  // than overlap — a duplicate poll of the same
  // hashtag mid-run wastes an Apify call for zero extra freshness, not a correctness issue,
  // but it's still pure waste. TTL matches maxDuration + a buffer so a killed invocation
  // self-recovers instead of wedging every future tick.
  if (!(await tryAcquireCronLock(LOCK_NAME, 800 + 60))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    // hashtagSnapshot.groupBy returns every hashtag ever tracked, with no expiry — a campaign
    // that's stayed "planned" (never went live) or a one-off manual/E2E-test hashtag stays in
    // this set and gets a full paid Apify hashtag scrape every single poll, forever, with
    // nothing to show for it. Confirmed in prod (2026-08-04 audit): an E2E test hashtag
    // (created by e2e/phase2-campaigns.spec.ts running against this same DATABASE_URL — see
    // AGENTS.md note to fix that test's isolation separately) had been polled repeatedly for
    // 0 posts every time. Scoped to hashtags belonging to at least one *live* campaign — same
    // campaign/agency-only philosophy as the comment-scrape scoping above.
    const liveCampaigns = await prisma.campaign.findMany({
      where: { status: "live" },
      select: { hashtags: true },
    });
    const liveHashtags = new Set(liveCampaigns.flatMap((c) => c.hashtags));

    const allTracked = await prisma.hashtagSnapshot.groupBy({ by: ["hashtag"] });
    const tracked = allTracked.filter((t) => liveHashtags.has(t.hashtag));
    const results: { hashtag: string; ok: boolean; skipped?: boolean; error?: string }[] = [];
    const touchedPostIds: string[] = [];
    let quotaExhausted = false;

    for (const { hashtag } of tracked) {
      // Once Apify has rejected on the monthly spend cap, the remaining hashtags in this
      // tick cannot succeed either — the cap is account-wide, not per-actor. Abandoning
      // the rest of the loop is where most of the saving is: before this, every tick paid
      // for one rejected call per tracked hashtag, which measured 1,098 failed runs over
      // the week the cap was hit. The breaker in trackedRun would refuse each of these
      // anyway; breaking here also skips its lookup.
      if (quotaExhausted) {
        results.push({ hashtag, ok: false, skipped: true, error: "Apify quota exhausted — not attempted" });
        continue;
      }
      try {
        touchedPostIds.push(...(await trackHashtag(hashtag)));
        results.push({ hashtag, ok: true });
      } catch (err) {
        if (isApifyQuotaFailure(err)) {
          quotaExhausted = true;
        }
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
    //
    // Scoped to campaign-linked posts only, not every touched post. Comment-scraping is the
    // expensive leg of this pipeline (pay-per-result Apify actor), and trackHashtag's return
    // value includes every post matching a tracked hashtag — including hashtags being watched
    // but never promoted to a live Campaign. Classifying every one of those at full comment
    // depth was spending the same budget on exploratory tags as on real campaigns. Posts
    // outside a campaign still get their aggregate/count stats from trackHashtag itself; they
    // just don't get comment-scraped + per-comment classified until/unless a campaign picks
    // them up (a later poll will catch them once backfillCampaignLink sets campaignId).
    //
    // Skipped entirely on a quota-exhausted tick: the comment scrape is the expensive leg
    // and it cannot succeed while the cap is hit, so queueing it would only burn the
    // comment-scrape cron lock and log failures. The posts stay unclassified and are picked
    // up by the first tick after credits are restored.
    if (touchedPostIds.length > 0 && !quotaExhausted) {
      const campaignPosts = await prisma.post.findMany({
        where: { id: { in: touchedPostIds }, campaignId: { not: null } },
        select: { id: true },
      });
      const campaignPostIds = campaignPosts.map((p) => p.id);
      if (campaignPostIds.length > 0) {
        after(() => queueSentimentClassification(campaignPostIds));
      }
    }

    // Same heartbeat also refreshes any tracked /compare competitor whose data has aged
    // past its TTL — this is the only background refresh path (see src/lib/data/compare.ts),
    // so it stays TTL-gated rather than re-scraping every cycle. Both refreshes are skipped
    // outright once the account-wide cap has been hit this tick: they'd each walk their full
    // stale list to fail on every entry.
    const competitorResults = quotaExhausted ? [] : await refreshStaleCompetitors();

    // And any tracked fan page past its TTL, on either platform. NB this whole route is
    // currently absent from vercel.json's cron list, so none of this runs on a schedule
    // today — fan pages refresh only when someone presses "Refresh data" on a detail
    // screen. This covers Instagram as
    // well as YouTube now: the hashtag scrape above only links a fan page's post when that
    // post carries a tracked tag and never revisits the profile, so without this an
    // Instagram page's follower count never moved after the day it was added (see
    // fanpages.ts's refreshStaleFanPages).
    //
    // Deliberately NOT skipped wholesale when quotaExhausted, unlike the competitor refresh
    // above: YouTube channels go through the YouTube Data API and its separate quota, so
    // skipping the whole call during an Apify outage would freeze YouTube fan-channel data
    // and save exactly zero Apify credit. The flag is passed through instead, so the
    // Instagram half is skipped and the YouTube half still runs.
    const fanPageResults = await refreshStaleFanPages(quotaExhausted);

    return NextResponse.json({
      polled: results.length,
      quotaExhausted,
      results,
      competitorsRefreshed: competitorResults,
      fanPagesRefreshed: fanPageResults,
    });
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}

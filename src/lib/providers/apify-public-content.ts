import {
  DEFAULT_MAX_CHARGE_USD,
  DEFAULT_WAIT_MS,
  getDatasetItems,
  runActor,
  waitForRun,
} from "@/lib/apify/client";
import {
  assertQuotaCircuitClosed,
  isAccountBudgetExhausted,
  QUOTA_ERROR_MARKER,
} from "@/lib/apify/quotaBreaker";
import { prisma } from "@/lib/prisma";
import {
  normalizeCommentItem,
  normalizeHashtagItem,
  normalizePostUrlItem,
  normalizeProfileItem,
  normalizeProfilePostItem,
  normalizeTrackedPostItem,
  postUrlKey,
  type NormalizedTrackedPost,
} from "./apify-normalize";
import {
  normalizeFacebookPostItem,
  type NormalizedFacebookPost,
} from "./apify-normalize-facebook-posts";
import { normalizeFacebookScoutItem } from "./apify-scout-normalize-facebook";
import type { AccountSnapshot, PublicContentProvider, RawPost } from "./types";

function actorEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — required for the live PublicContentProvider`);
  return v;
}

// Handle -> FanPage.id for every currently-tracked (active) fan page, lowercased so
// matching against a post's author_handle is case-insensitive. Fetched once per
// storePosts call rather than per-post — the fan_pages table is small and this avoids
// N redundant queries across a 150-post hashtag scrape.
async function activeFanPageMap(): Promise<Map<string, string>> {
  const pages = await prisma.fanPage.findMany({ where: { isActive: true }, select: { id: true, igHandle: true } });
  return new Map(pages.map((p) => [p.igHandle.toLowerCase(), p.id]));
}

// Upserts by ig_shortcode: re-scraping the same post updates its metrics instead of
// duplicating the row. Posts without a shortcode (shouldn't happen for real actor
// output, but the schema allows null) are skipped rather than upserted on an empty key.
//
// campaignId is set on the INSERT itself (not backfilled after) because Supabase
// Realtime's live post stream subscribes to INSERT events filtered by campaign_id —
// an insert with campaign_id NULL followed by a later UPDATE would never fire that
// filter, silently breaking the live stream (it'd only ever show up on a refresh).
// fanPageId has no such Realtime dependency, so it's set on both the create AND
// update branches directly — no separate "backfill on the update path" trick needed
// for posts touched by *this* scrape. backfillFanPageLink() below only covers posts
// that a scrape never re-touches at all (already-scraped history for a handle that
// becomes a tracked fan page only just now).
async function storePosts(posts: RawPost[], campaignId: string | null = null): Promise<void> {
  const fanPageMap = await activeFanPageMap();
  for (const p of posts) {
    if (!p.igShortcode) continue;
    const fanPageId = p.authorHandle ? (fanPageMap.get(p.authorHandle.toLowerCase()) ?? null) : null;
    await prisma.post.upsert({
      where: { platform_igShortcode: { platform: p.platform, igShortcode: p.igShortcode } },
      create: {
        source: p.source,
        platform: p.platform,
        igShortcode: p.igShortcode,
        externalUrl: p.externalUrl,
        authorHandle: p.authorHandle,
        mediaType: p.mediaType,
        caption: p.caption,
        postedAt: new Date(p.postedAt),
        reach: p.reach,
        likes: p.likes,
        comments: p.comments,
        saves: p.saves,
        shares: p.shares,
        raw: p.raw as object,
        campaignId,
        fanPageId,
      },
      update: {
        externalUrl: p.externalUrl,
        authorHandle: p.authorHandle,
        mediaType: p.mediaType,
        caption: p.caption,
        postedAt: new Date(p.postedAt),
        reach: p.reach,
        likes: p.likes,
        comments: p.comments,
        saves: p.saves,
        shares: p.shares,
        raw: p.raw as object,
        fanPageId,
        scrapedAt: new Date(),
      },
    });
  }
}

// Called once when a handle is newly added (or promoted from a suggestion) as a
// tracked FanPage — attributes any posts scraped *before* that handle was tracked
// (storePosts only sets fanPageId going forward). Case-insensitive on author_handle,
// scoped to this one handle so it's cheap even against a large posts table.
export async function backfillFanPageLink(handle: string, fanPageId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE posts
    SET fan_page_id = ${fanPageId}
    WHERE fan_page_id IS NULL
      AND lower(author_handle) = lower(${handle})
  `;
}

// Resolves the live campaign (if any) that tracks this hashtag — tag must already
// be lowercased to match createCampaign/trackHashtag's normalization.
async function findCampaignForTag(tag: string): Promise<string | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { status: "live", hashtags: { has: tag } },
    select: { id: true },
  });
  return campaign?.id ?? null;
}

// Backfill for posts upserted by a *previous* scrape (the UPDATE branch of
// storePosts's upsert), e.g. a post first scraped before the campaign existed, or
// before this campaign started tracking the tag. New inserts get campaignId set
// directly by storePosts so the Realtime INSERT filter matches immediately —
// this only catches the update-path case, which Realtime doesn't need to see live.
async function backfillCampaignLink(tag: string, campaignId: string | null): Promise<void> {
  if (!campaignId) return;
  await prisma.$executeRaw`
    UPDATE posts
    SET campaign_id = ${campaignId}
    WHERE campaign_id IS NULL
      AND raw -> 'hashtags' @> to_jsonb(ARRAY[${tag}]::text[])
  `;
}

// Every actor we use is PAY_PER_EVENT and bills per dataset item, on a tiered schedule
// running from $0.0026 (FREE) down to $0.0014 (DIAMOND) — verified against each actor's
// `pricingInfos`, 2026-08-07.
//
// Deliberately the WORST tier, not the one we believe we're on. This number only ever
// derives a spend ceiling: over-estimating means the cap sits harmlessly above what a run
// can spend, while under-estimating means Apify aborts a legitimate run partway — and
// since the batch is marked commentsScrapedAt as soon as the run completes, those posts
// would never be retried. Guessing the tier wrong in one direction costs nothing; in the
// other it silently loses data. So don't guess.
const APIFY_ITEM_PRICE_USD = 0.0026;

// Charge cap for a run expected to produce at most `maxItems` dataset items, with 10%
// headroom so ordinary variance (the comment scraper can slightly overshoot its own
// resultsLimit — see the 225-comment observation in sentiment.ts) doesn't clip results.
// Clamped by DEFAULT_MAX_CHARGE_USD, the absolute per-run ceiling defined alongside the
// run option that enforces it — one env var, one default, no second opinion here.
function chargeCapFor(maxItems: number): number {
  return Math.min(DEFAULT_MAX_CHARGE_USD, Math.max(0.01, maxItems * APIFY_ITEM_PRICE_USD * 1.1));
}

interface TrackedRunOptions {
  /** Upper bound on dataset items this run should produce, used to derive its spend cap. */
  maxItems: number;
  /**
   * How long to wait before abandoning (and aborting) the run. Must be below the calling
   * route's Vercel `maxDuration`, or the function is killed mid-wait and the abort never
   * happens — which is what left runs billing for hours with nobody reading them.
   */
  waitMs?: number;
}

// Runs one actor to completion inside a tracked scrape_runs row: queued -> running ->
// done/error, with apify_run_id/started_at/finished_at/item_count populated. This is
// the audit trail Phase 2's polling cron depends on — not a nice-to-have.
async function trackedRun<T>(
  kind: string,
  actorId: string,
  input: Record<string, unknown>,
  { maxItems, waitMs = DEFAULT_WAIT_MS }: TrackedRunOptions,
): Promise<T[]> {
  // Before the scrape_runs row, not after: a skipped call never reached Apify, so
  // recording it would both falsify the audit trail and — because the circuit derives
  // its state from that same trail — keep pushing its own cooldown forward.
  await assertQuotaCircuitClosed(actorId);

  const run = await prisma.scrapeRun.create({ data: { kind, status: "queued" } });
  try {
    const { runId, datasetId: initialDatasetId } = await runActor(actorId, input, {
      maxChargeUsd: chargeCapFor(maxItems),
      // Apify's own kill switch, set above our wait budget so we always give up first
      // under normal conditions — this only matters when the abort call itself fails.
      timeoutSecs: Math.ceil(waitMs / 1000) + 60,
    });
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "running", apifyRunId: runId, startedAt: new Date() },
    });

    const finished = await waitForRun(runId, { timeoutMs: waitMs });
    if (finished.status !== "SUCCEEDED") {
      // A run that started legally and then died can be the monthly cap being reached
      // mid-flight — Apify reports that as a plain ABORTED/FAILED with no quota marker
      // anywhere in it, so the 403-based circuit breaker structurally cannot see it. Ask
      // the account directly and stamp the marker ourselves when that's the cause, which
      // is what opens the circuit and stops the rest of this tick attempting the same.
      const quotaHit = await isAccountBudgetExhausted();
      const error = quotaHit
        ? `Apify run ended with status ${finished.status} — account budget exhausted (${QUOTA_ERROR_MARKER})`
        : `Apify run ended with status ${finished.status}`;
      await prisma.scrapeRun.update({
        where: { id: run.id },
        data: { status: "error", finishedAt: new Date(), error },
      });
      return [];
    }

    const items = await getDatasetItems<T>(finished.datasetId || initialDatasetId);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date(), itemCount: items.length },
    });
    return items;
  } catch (err) {
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

// Was uncapped (100,000) for one day (2026-07-31) — reverted to a bounded default the same
// day after two real problems surfaced at that setting: (1) large comment threads pushed
// individual Apify runs past the wait timeout, and worse, backend
// invocations processing them were observed dying silently mid-run with no error logged,
// leaving stuck cron locks and orphaned scrape_run rows that blocked all further progress;
// (2) real measured cost hit $2.30/1000 comments (confirmed via Apify run-level billing,
// not the estimate), and a handful of large-thread scrapes burned through most of a
// $29/month Starter budget in under a day. 200/post is a deliberate policy tradeoff, not a
// technical ceiling — real per-run cost stays under $0.50/post and scrapes finish fast
// enough to avoid the timeout/silent-death failure mode above. Env-configurable so this is
// a policy knob, not a redeploy, if it needs tuning either direction.
const COMMENTS_PER_POST_LIMIT = Number(process.env.COMMENTS_PER_POST_LIMIT) || 200;

// `resultsLimit` is applied PER URL, not per run — confirmed against the actor's own input
// schema: "If set to 5, you will get 5 comments per URL. If you add 2 URLs, you will extract
// 10 results altogether." That makes a batched run's cost `urls × resultsLimit`, and nothing
// in the actor input bounds `urls`. Before these two caps, backfill-sentiment's CHUNK_SIZE
// of 300 could put 300 URLs into a single run: 60,000 comments, ~$138, on a $29/month plan.
//
// 10 per run keeps a run's derived cap (10 × 200 × $0.0026 × 1.1 = $5.72) below
// DEFAULT_MAX_CHARGE_USD ($6), so the Apify-side spend cap stays a runaway guard rather
// than something that truncates real results. Raising this without raising that ceiling
// would start clamping full batches — see the note on APIFY_ITEM_PRICE_USD for why that
// loses data rather than just costing less.
const COMMENT_POSTS_PER_RUN = Number(process.env.APIFY_COMMENT_POSTS_PER_RUN) || 10;
// And a ceiling on the whole call, so one caller with a large backlog spreads it across
// invocations instead of spending it all at once. The backlog still drains — every post is
// now attempted exactly once (see commentsScrapedAt), so this bounds the rate, not the total.
const COMMENT_POSTS_PER_INVOCATION = Number(process.env.APIFY_COMMENT_POSTS_PER_INVOCATION) || 20;

// Shorter than the 5-minute default because this is the one call that issues several runs
// back to back: 2 runs × 3 min has to fit inside the *caller's* remaining function budget,
// alongside whatever ingestion work already ran before it. A comment run over 10 URLs
// finishes well inside this in practice; going over means something is wrong with the run,
// and the right response is to abort it (waitForRun does) rather than wait it out.
const COMMENT_RUN_WAIT_MS = Number(process.env.APIFY_COMMENT_RUN_WAIT_MS) || 3 * 60 * 1000;

// Only ever called from the sentiment pipeline (src/lib/data/sentiment.ts) for posts about
// to be classified — never wired to the hashtag cron or agency batch scrape directly (see
// AGENTS.md Phase 4 §A4). Comments aren't re-scraped once captured, so this is insert-only;
// callers are responsible for only passing posts that don't already have post_comments rows.
//
// Returns the ids of every post actually attempted, so the caller can record the attempt.
export async function scrapeCommentsForPosts(
  posts: { id: string; externalUrl: string }[],
): Promise<string[]> {
  const targets = posts.filter((p) => p.externalUrl).slice(0, COMMENT_POSTS_PER_INVOCATION);
  if (targets.length === 0) return [];
  if (posts.length > targets.length) {
    console.log(
      `comment scrape: ${posts.length} post(s) requested, taking ${targets.length} this invocation (cap: ${COMMENT_POSTS_PER_INVOCATION}) — the rest are picked up next pass`,
    );
  }

  const attempted: string[] = [];
  // Multiple URLs per run: apify/instagram-comment-scraper's `directUrls` input accepts
  // several post/reel URLs at once (confirmed against a live 2-URL sample run, 2026-07-16),
  // so this is one run per COMMENT_POSTS_PER_RUN posts rather than one run per post.
  for (let i = 0; i < targets.length; i += COMMENT_POSTS_PER_RUN) {
    const batch = targets.slice(i, i + COMMENT_POSTS_PER_RUN);
    const keyToPostId = new Map(batch.map((p) => [postUrlKey(p.externalUrl), p.id]));

    const items = await trackedRun<Record<string, unknown>>(
      "comment_scrape",
      actorEnv("APIFY_ACTOR_COMMENTS"),
      {
        directUrls: batch.map((p) => p.externalUrl),
        resultsLimit: COMMENTS_PER_POST_LIMIT,
        includeNestedComments: false,
      },
      { maxItems: batch.length * COMMENTS_PER_POST_LIMIT, waitMs: COMMENT_RUN_WAIT_MS },
    );

    // Recorded whether or not the run yielded anything: a post that is private, deleted or
    // has comments disabled will never yield rows, and without this it re-qualified for a
    // fresh paid scrape on every staleness cycle, forever.
    //
    // Written per batch rather than once at the end so a later batch throwing (quota,
    // timeout) can't discard the record of batches that already ran and were paid for.
    // Conversely a batch that throws is never marked, so a genuinely transient failure
    // still retries — the marker means "we spent money finding out", not "we tried".
    const batchIds = batch.map((p) => p.id);
    attempted.push(...batchIds);
    await prisma.post.updateMany({ where: { id: { in: batchIds } }, data: { commentsScrapedAt: new Date() } });

    let unattributed = 0;
    for (const item of items) {
      // `postUrl` echoes the input directUrls entry — this is how a single batched run's
      // mixed-order results get attributed back to the right post (see apify-normalize.ts).
      // `inputUrl` is the fallback field name; and with a single-URL batch there is only one
      // post it could possibly belong to, so attribution can't be ambiguous there.
      const rawUrl =
        (typeof item.postUrl === "string" && item.postUrl) ||
        (typeof item.inputUrl === "string" && item.inputUrl) ||
        null;
      const postId = rawUrl
        ? keyToPostId.get(postUrlKey(rawUrl))
        : batch.length === 1
          ? batch[0].id
          : undefined;
      if (!postId) {
        unattributed++;
        continue;
      }
      const comment = normalizeCommentItem(item, postId);
      await prisma.postComment.create({
        data: {
          postId: comment.postId,
          igCommentId: comment.igCommentId,
          authorHandle: comment.authorHandle,
          text: comment.text,
          postedAt: comment.postedAt ? new Date(comment.postedAt) : null,
          raw: comment.raw as object,
        },
      });
    }
    if (unattributed > 0) {
      // Loud on purpose: these are comments we paid for and threw away. A nonzero count
      // here means the actor's URL echo no longer matches what postUrlKey extracts, which
      // is a silent 100%-waste failure mode if nobody is watching for it.
      console.error(
        `comment scrape: ${unattributed}/${items.length} item(s) could not be attributed to a post — paid for and discarded`,
      );
    }
  }
  return attempted;
}

// Profile-only Apify call, factored out of scrapeByHandle so fan-page onboarding
// (Phase 5) can get a followers/display-name snapshot without also paying for the
// post-history scrape leg — a newly-added fan page's post history accumulates for
// free from the hashtag stream via fanPageId linking instead.
export async function fetchProfileSnapshot(handle: string): Promise<AccountSnapshot> {
  const cleanHandle = handle.replace(/^@/, "");
  const profileItems = await trackedRun<Record<string, unknown>>(
    "profile",
    actorEnv("APIFY_ACTOR_PROFILE"),
    {
      usernames: [cleanHandle],
      // Explicitly off: the actor bills this as a separate, more expensive "about-account"
      // event ($0.006/profile on top of $0.0023), and nothing here reads date-joined or
      // country — normalizeProfileItem only takes followers/fullName/postsCount.
      includeAboutSection: false,
    },
    { maxItems: 1 },
  );
  const snapshot = profileItems[0]
    ? normalizeProfileItem(profileItems[0])
    : { followers: 0, displayName: cleanHandle, postsCount: null };
  return {
    handle: cleanHandle,
    displayName: snapshot.displayName || cleanHandle,
    followers: snapshot.followers,
    avgLikesPerPost: 0,
    postsPerWeek: 0,
    reelAvgViews: 0,
    engagementRateEstimate: 0,
    storyResponseRate: null,
  };
}

// Results per hashtag poll. `resultsLimit` is per hashtag on this actor too, but we only
// ever pass one tag per run, so this is also the per-run item count. At $0.0023/result this
// is $0.345 a poll — the single biggest recurring line item in the account, and the number
// to turn down first if the plan budget is tight (see APIFY-USAGE-AUDIT.md §I). Env-tunable
// so that's a config change, not a redeploy.
const HASHTAG_RESULTS_LIMIT = Number(process.env.APIFY_HASHTAG_RESULTS_LIMIT) || 150;

// Posts pulled per profile in scrapeByHandle. Same pay-per-item deal as everything else.
const HANDLE_POSTS_LIMIT = Number(process.env.APIFY_HANDLE_POSTS_LIMIT) || 50;

// The post scraper's `dataDetailLevel` defaults to "detailedData", which Apify bills as a
// SEPARATE, extra charge event on top of the per-post one ($0.0008 + $0.0015 vs $0.0015
// alone — a ~53% surcharge). Nothing downstream reads any of what it buys: apify-normalize's
// toRawPost maps reach to null on purpose and never touches a detailed field. Paying for it
// was pure waste, so this is pinned to the basic tier rather than left on the actor default.
const POST_DATA_DETAIL_LEVEL = "basicData";

export class ApifyPublicContentProvider implements PublicContentProvider {
  async scrapeByHashtag(tag: string): Promise<RawPost[]> {
    // Lowercased to match createCampaign/trackHashtag's normalization — hashtags:{has}
    // is case-sensitive, so an un-lowercased tag here would silently fail to link.
    const cleanTag = tag.replace(/^#/, "").toLowerCase();
    const campaignId = await findCampaignForTag(cleanTag);
    const items = await trackedRun<Record<string, unknown>>(
      "hashtag",
      actorEnv("APIFY_ACTOR_HASHTAG"),
      {
        hashtags: [cleanTag],
        resultsLimit: HASHTAG_RESULTS_LIMIT,
      },
      { maxItems: HASHTAG_RESULTS_LIMIT },
    );
    const posts = items.map(normalizeHashtagItem);
    await storePosts(posts, campaignId);
    await backfillCampaignLink(cleanTag, campaignId);
    return posts;
  }

  async scrapeByHandle(handle: string): Promise<AccountSnapshot & { posts: RawPost[] }> {
    const cleanHandle = handle.replace(/^@/, "");
    const snapshot = await fetchProfileSnapshot(cleanHandle);

    const postItems = await trackedRun<Record<string, unknown>>(
      "handle-posts",
      actorEnv("APIFY_ACTOR_POST"),
      {
        username: [cleanHandle],
        resultsLimit: HANDLE_POSTS_LIMIT,
        dataDetailLevel: POST_DATA_DETAIL_LEVEL,
      },
      { maxItems: HANDLE_POSTS_LIMIT },
    );
    const posts = postItems.map((item) => normalizeProfilePostItem(item));

    const recentLikes = posts.slice(0, 20).map((p) => p.likes);
    const avgLikesPerPost = recentLikes.length ? recentLikes.reduce((a, b) => a + b, 0) / recentLikes.length : 0;
    const engagementRateEstimate = snapshot.followers > 0 ? (avgLikesPerPost / snapshot.followers) * 100 : 0;

    return {
      ...snapshot,
      avgLikesPerPost,
      postsPerWeek: 0, // not derivable from a single post-history page; Phase 2+ can compute from posted_at spread
      reelAvgViews: 0, // videoViewCount isn't reach and isn't collected here yet
      engagementRateEstimate: Math.round(engagementRateEstimate * 100) / 100,
      posts,
    };
  }

  async scrapeByUrls(urls: string[]): Promise<RawPost[]> {
    if (urls.length === 0) return [];
    // apify/instagram-post-scraper's input schema has a single `username` array field
    // that accepts usernames, profile URLs, *or* post URLs — there is no separate
    // "directUrls" field (confirmed against the actor's build input schema).
    const items = await trackedRun<Record<string, unknown>>(
      "urls",
      actorEnv("APIFY_ACTOR_POST"),
      {
        username: urls,
        // A no-op for post URLs by the actor's own documentation ("This setting does not
        // apply if you're scraping by post URLs"), which is exactly why it's set: if a
        // profile URL ever survives the caller's post-URL validation, this caps it at one
        // post instead of letting the actor walk the whole profile history on our tab.
        resultsLimit: 1,
        dataDetailLevel: POST_DATA_DETAIL_LEVEL,
      },
      { maxItems: urls.length },
    );
    const posts = items.map((item) => normalizePostUrlItem(item));
    await storePosts(posts);
    return posts;
  }
}

// ---------------------------------------------------------------------------
// Campaign Post Tracking
// ---------------------------------------------------------------------------

/**
 * SCOPED EXCEPTION TO APIFY-USAGE-AUDIT.md FINDING K — DO NOT "FIX" THIS BACK.
 *
 * Finding K pinned `dataDetailLevel` to "basicData" everywhere because the paid tier
 * (+$0.0008/post on top of $0.0015, a ~53% surcharge) bought a `videoPlayCount` that
 * *nothing consumed*. That reasoning is still correct for every other call path in this
 * file, and they all stay on POST_DATA_DETAIL_LEVEL.
 *
 * Campaign Post Tracking is the one consumer: view count is the most-asked-for number on an
 * influencer deliverable, and without it Instagram — the platform most of the campaign runs
 * on — reports likes and comments only. Direction 2026-08-21 was explicit that the cost is
 * acceptable ("I don't mind paying extra, I need the data"); at ~100 tracked posts scanned
 * daily the surcharge is about $2.40/month.
 *
 * See CAMPAIGN-POST-TRACKING.md §1a. If you are here to re-apply finding K, read that first.
 */
const TRACKED_POST_DATA_DETAIL_LEVEL = "detailedData";

/**
 * Fetch current metrics for a batch of tracked Instagram post URLs.
 *
 * Deliberately does NOT persist: unlike scrapeByUrls above, this writes nothing to `posts`.
 * A tracked post lives in its own table with its own snapshot history, and letting this
 * path upsert into `posts` would collide with the agency pipeline over the same shortcode
 * (CAMPAIGN-POST-TRACKING.md §2a). Storage is the caller's job.
 */
// How far back the first scrape of a page looks when we don't yet know the tracked post's
// date. Once a post is stored we know exactly when it was published and bound the scrape to
// that instead (see fetchTrackedFacebookPosts), so this only ever applies to a first
// ingest. Three months is generous for a campaign post someone is pasting in by hand, and
// cheap: influencer pages in this account's own Scoutline data post a median of ~1 post per
// week, so three months is typically a dozen or so items.
const FB_INITIAL_LOOKBACK = process.env.APIFY_FB_INITIAL_LOOKBACK || "3 months";

// Hard ceiling on items per page run, whatever the date bound implies. A page that posts
// far more often than the median (the same Scoutline data has a max of 112/week) would
// otherwise turn one tracked post into a very large bill.
const FB_MAX_POSTS_PER_PAGE = Number(process.env.APIFY_FB_MAX_POSTS_PER_PAGE) || 200;

/**
 * Current metrics for tracked Facebook posts on ONE page.
 *
 * Facebook has no post-URL actor (see apify-normalize-facebook-posts.ts for the full
 * reasoning), so this scrapes the page and the caller matches posts out of the result by
 * ID. `onlyPostsNewerThan` is what keeps that honest and cheap: bounded to just before the
 * oldest post we are tracking on this page, the run is guaranteed to reach every one of
 * them rather than hoping a fixed result count went deep enough.
 *
 * Persists nothing — same as the Instagram tracked-post path.
 */
export async function fetchTrackedFacebookPosts(
  pageUrl: string,
  oldestPostedAt: Date | null,
): Promise<NormalizedFacebookPost[]> {
  // One day of slack: the actor's date filter and the post's own timestamp can disagree by
  // a few hours across timezones, and losing the oldest post to an off-by-one would look
  // exactly like that post having been deleted.
  const newerThan = oldestPostedAt
    ? new Date(oldestPostedAt.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : FB_INITIAL_LOOKBACK;

  const items = await trackedRun<Record<string, unknown>>(
    "tracked-posts-facebook",
    // Defaulted rather than required via actorEnv(): that helper throws when unset, and
    // nothing in the existing deployment sets this. Same pattern as Scoutline's
    // FACEBOOK_ACTOR_ID — the env var exists to override, not to be mandatory.
    process.env.APIFY_ACTOR_FACEBOOK_POSTS || "apify/facebook-posts-scraper",
    {
      startUrls: [{ url: pageUrl }],
      onlyPostsNewerThan: newerThan,
      resultsLimit: FB_MAX_POSTS_PER_PAGE,
    },
    { maxItems: FB_MAX_POSTS_PER_PAGE },
  );
  return items.map((item) => normalizeFacebookPostItem(item));
}

/**
 * Follower count for a Facebook page.
 *
 * Reuses the same actor and normalizer Scoutline already runs for Facebook pages, rather
 * than adding a second page-scraping path — the follower number is the same number, and
 * that normalizer already encodes what this repo learned from live runs about how
 * inconsistently Facebook pages come back.
 */
export async function fetchFacebookPageSnapshot(
  pageUrl: string,
): Promise<{ displayName: string | null; followers: number | null; raw: Record<string, unknown> | null }> {
  const items = await trackedRun<Record<string, unknown>>(
    "tracked-account-facebook",
    process.env.APIFY_ACTOR_SCOUT_FACEBOOK || "apify/facebook-pages-scraper",
    { startUrls: [{ url: pageUrl }] },
    { maxItems: 1 },
  );
  if (items.length === 0) return { displayName: null, followers: null, raw: null };
  const normalized = normalizeFacebookScoutItem(items[0]);
  return {
    displayName: normalized.pageUsername,
    followers: normalized.followers,
    raw: normalized.raw,
  };
}

// Posts pulled per page when discovering an account's recent content. Separate from
// HANDLE_POSTS_LIMIT so tracking can be tuned without moving the competitor/fan-page
// scrape, which serves a different purpose on a different cost profile.
const TRACKED_DISCOVERY_LIMIT = Number(process.env.APIFY_TRACKED_DISCOVERY_LIMIT) || 50;

/**
 * Recent posts from ONE Instagram account, for page subscriptions.
 *
 * Deliberately NOT `scrapeByHandle`, for two reasons that both bite silently:
 *   - it requests POST_DATA_DETAIL_LEVEL ("basicData"), so every discovered reel would come
 *     back with no play count and render "—" for plays. That is indistinguishable from the
 *     null-discipline being broken, on the one platform the campaign mostly runs on. This
 *     path opts into the paid detail tier exactly like fetchTrackedInstagramPosts, for the
 *     same reason and under the same §1a exception.
 *   - it also returns an AccountSnapshot shaped for the `posts` table. A tracked post
 *     belongs in tracked_posts, and its account snapshot is written separately.
 */
export async function discoverInstagramAccountPosts(handle: string): Promise<NormalizedTrackedPost[]> {
  const cleanHandle = handle.replace(/^@/, "");
  const items = await trackedRun<Record<string, unknown>>(
    "tracked-discovery",
    actorEnv("APIFY_ACTOR_POST"),
    {
      username: [cleanHandle],
      resultsLimit: TRACKED_DISCOVERY_LIMIT,
      dataDetailLevel: TRACKED_POST_DATA_DETAIL_LEVEL,
    },
    { maxItems: TRACKED_DISCOVERY_LIMIT },
  );
  return items.map((item) => normalizeTrackedPostItem(item));
}

/**
 * Recent posts from ONE Facebook page.
 *
 * Facebook needs no separate discovery path: fetchTrackedFacebookPosts already works by
 * scraping the page, because Facebook has no post-by-URL actor at all. Discovery is the
 * same call with no post-matching afterwards — which is the one place Facebook's awkward
 * shape is an advantage.
 */
export async function discoverFacebookPagePosts(
  pageUrl: string,
  since: Date | null,
): Promise<NormalizedFacebookPost[]> {
  return fetchTrackedFacebookPosts(pageUrl, since);
}

export async function fetchTrackedInstagramPosts(urls: string[]): Promise<NormalizedTrackedPost[]> {
  if (urls.length === 0) return [];
  const items = await trackedRun<Record<string, unknown>>(
    "tracked-posts",
    actorEnv("APIFY_ACTOR_POST"),
    {
      // Same single `username` array the actor uses for usernames, profile URLs and post
      // URLs alike — see scrapeByUrls for the confirmation note.
      username: urls,
      resultsLimit: 1,
      dataDetailLevel: TRACKED_POST_DATA_DETAIL_LEVEL,
    },
    { maxItems: urls.length },
  );
  return items.map((item) => normalizeTrackedPostItem(item));
}

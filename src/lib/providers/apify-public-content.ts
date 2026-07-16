import { getDatasetItems, runActor, waitForRun } from "@/lib/apify/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeCommentItem,
  normalizeHashtagItem,
  normalizePostUrlItem,
  normalizeProfileItem,
  normalizeProfilePostItem,
} from "./apify-normalize";
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
      where: { igShortcode: p.igShortcode },
      create: {
        source: p.source,
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

// Runs one actor to completion inside a tracked scrape_runs row: queued -> running ->
// done/error, with apify_run_id/started_at/finished_at/item_count populated. This is
// the audit trail Phase 2's polling cron depends on — not a nice-to-have.
async function trackedRun<T>(kind: string, actorId: string, input: Record<string, unknown>): Promise<T[]> {
  const run = await prisma.scrapeRun.create({ data: { kind, status: "queued" } });
  try {
    const { runId, datasetId: initialDatasetId } = await runActor(actorId, input);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "running", apifyRunId: runId, startedAt: new Date() },
    });

    const finished = await waitForRun(runId);
    if (finished.status !== "SUCCEEDED") {
      await prisma.scrapeRun.update({
        where: { id: run.id },
        data: { status: "error", finishedAt: new Date(), error: `Apify run ended with status ${finished.status}` },
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

// Comments matching the DPR's suggested cap — a viral post's comment section can run into
// the thousands, and this is a per-post limit passed straight to the actor's own
// resultsLimit input, not a client-side truncation after the fact.
const COMMENTS_PER_POST_LIMIT = 20;

// Only ever called from the sentiment pipeline (src/lib/data/sentiment.ts) for posts about
// to be classified — never wired to the hashtag cron or agency batch scrape directly (see
// AGENTS.md Phase 4 §A4). Comments aren't re-scraped once captured, so this is insert-only;
// callers are responsible for only passing posts that don't already have post_comments rows.
export async function scrapeCommentsForPosts(posts: { id: string; externalUrl: string }[]): Promise<void> {
  const targets = posts.filter((p) => p.externalUrl);
  if (targets.length === 0) return;

  // One actor run per batch: apify/instagram-comment-scraper's `directUrls` input accepts
  // multiple post/reel URLs at once (confirmed against a live 2-URL sample run, 2026-07-16),
  // so this is 1 Apify run for the whole batch, not N sequential runs.
  const urlToPostId = new Map(targets.map((p) => [p.externalUrl, p.id]));
  const items = await trackedRun<Record<string, unknown>>("comment_scrape", actorEnv("APIFY_ACTOR_COMMENTS"), {
    directUrls: targets.map((p) => p.externalUrl),
    resultsLimit: COMMENTS_PER_POST_LIMIT,
    includeNestedComments: false,
  });

  for (const item of items) {
    // `postUrl` echoes the input directUrls entry verbatim — this is how a single batched
    // run's mixed-order results get attributed back to the right post (see apify-normalize.ts).
    const postUrl = typeof item.postUrl === "string" ? item.postUrl : null;
    const postId = postUrl ? urlToPostId.get(postUrl) : undefined;
    if (!postId) continue;
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
}

// Profile-only Apify call, factored out of scrapeByHandle so fan-page onboarding
// (Phase 5) can get a followers/display-name snapshot without also paying for the
// post-history scrape leg — a newly-added fan page's post history accumulates for
// free from the hashtag stream via fanPageId linking instead.
export async function fetchProfileSnapshot(handle: string): Promise<AccountSnapshot> {
  const cleanHandle = handle.replace(/^@/, "");
  const profileItems = await trackedRun<Record<string, unknown>>("profile", actorEnv("APIFY_ACTOR_PROFILE"), {
    usernames: [cleanHandle],
  });
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

export class ApifyPublicContentProvider implements PublicContentProvider {
  async scrapeByHashtag(tag: string): Promise<RawPost[]> {
    // Lowercased to match createCampaign/trackHashtag's normalization — hashtags:{has}
    // is case-sensitive, so an un-lowercased tag here would silently fail to link.
    const cleanTag = tag.replace(/^#/, "").toLowerCase();
    const campaignId = await findCampaignForTag(cleanTag);
    const items = await trackedRun<Record<string, unknown>>("hashtag", actorEnv("APIFY_ACTOR_HASHTAG"), {
      hashtags: [cleanTag],
      resultsLimit: 150,
    });
    const posts = items.map(normalizeHashtagItem);
    await storePosts(posts, campaignId);
    await backfillCampaignLink(cleanTag, campaignId);
    return posts;
  }

  async scrapeByHandle(handle: string): Promise<AccountSnapshot & { posts: RawPost[] }> {
    const cleanHandle = handle.replace(/^@/, "");
    const snapshot = await fetchProfileSnapshot(cleanHandle);

    const postItems = await trackedRun<Record<string, unknown>>("handle-posts", actorEnv("APIFY_ACTOR_POST"), {
      username: [cleanHandle],
      resultsLimit: 50,
    });
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
    // apify/instagram-post-scraper's input schema has a single `username` array field
    // that accepts usernames, profile URLs, *or* post URLs — there is no separate
    // "directUrls" field (confirmed against the actor's build input schema).
    const items = await trackedRun<Record<string, unknown>>("urls", actorEnv("APIFY_ACTOR_POST"), {
      username: urls,
    });
    const posts = items.map((item) => normalizePostUrlItem(item));
    await storePosts(posts);
    return posts;
  }
}

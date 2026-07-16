import { getDatasetItems, runActor, waitForRun } from "@/lib/apify/client";
import { prisma } from "@/lib/prisma";
import {
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

// Upserts by ig_shortcode: re-scraping the same post updates its metrics instead of
// duplicating the row. Posts without a shortcode (shouldn't happen for real actor
// output, but the schema allows null) are skipped rather than upserted on an empty key.
//
// campaignId is set on the INSERT itself (not backfilled after) because Supabase
// Realtime's live post stream subscribes to INSERT events filtered by campaign_id —
// an insert with campaign_id NULL followed by a later UPDATE would never fire that
// filter, silently breaking the live stream (it'd only ever show up on a refresh).
async function storePosts(posts: RawPost[], campaignId: string | null = null): Promise<void> {
  for (const p of posts) {
    if (!p.igShortcode) continue;
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
        scrapedAt: new Date(),
      },
    });
  }
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

    const profileItems = await trackedRun<Record<string, unknown>>("profile", actorEnv("APIFY_ACTOR_PROFILE"), {
      usernames: [cleanHandle],
    });
    const snapshot = profileItems[0] ? normalizeProfileItem(profileItems[0]) : { followers: 0, displayName: cleanHandle, postsCount: null };

    const postItems = await trackedRun<Record<string, unknown>>("handle-posts", actorEnv("APIFY_ACTOR_POST"), {
      username: [cleanHandle],
      resultsLimit: 50,
    });
    const posts = postItems.map((item) => normalizeProfilePostItem(item));

    const recentLikes = posts.slice(0, 20).map((p) => p.likes);
    const avgLikesPerPost = recentLikes.length ? recentLikes.reduce((a, b) => a + b, 0) / recentLikes.length : 0;
    const engagementRateEstimate = snapshot.followers > 0 ? (avgLikesPerPost / snapshot.followers) * 100 : 0;

    return {
      handle: cleanHandle,
      displayName: snapshot.displayName || cleanHandle,
      followers: snapshot.followers,
      avgLikesPerPost,
      postsPerWeek: 0, // not derivable from a single post-history page; Phase 2+ can compute from posted_at spread
      reelAvgViews: 0, // videoViewCount isn't reach and isn't collected here yet
      engagementRateEstimate: Math.round(engagementRateEstimate * 100) / 100,
      storyResponseRate: null, // Graph-API-only, never available for a non-owned account
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

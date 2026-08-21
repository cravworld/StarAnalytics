// Campaign Post Tracking — ingest and queries. See CAMPAIGN-POST-TRACKING.md.
//
// QUERY DISCIPLINE: every read path here must issue a number of queries that does NOT grow
// with the number of tracked posts or accounts. The pool is 5 connections and /fan-pages
// already died on exactly this shape (six queries per tracked page, P2024 once ten pages
// existed). That is why TrackedPost carries denormalized cur*/prev* columns — the grid
// reads one table, and tracked_post_snapshots is touched only by the per-post trend view.
// Pinned by trackedPostsQueryCount.test.ts.

import { prisma } from "@/lib/prisma";
import type { TrackPlatform } from "@prisma/client";
import {
  aggregate,
  baselineDeltaPct,
  commentRatio,
  engagement,
  engagementRatePct,
  percentileRank,
  velocityPerDay,
  viewRate,
  type AggregateTotals,
} from "@/lib/tracking/insights";
import { accountKeyFor, facebookPageFrom, parsePostUrl, type TrackPlatformId } from "@/lib/tracking/postUrl";
import { profileUrlKey } from "@/lib/scout/ingest";
import {
  getTrackedPostProvider,
  PlatformNotSupportedError,
  type TrackedPostScrape,
} from "@/lib/tracking/provider";

// Matches AGENCY_SCRAPE_BATCH_SIZE rather than inventing a second ceiling — same actor,
// same operational time box per run.
const SCRAPE_BATCH_SIZE = 200;

// An account's follower count is re-scraped at most this often. Followers move slowly and a
// profile scrape is a separate charge, so refreshing per post (rather than per account per
// day) would multiply the cost by the number of posts that account delivered for no gain.
const ACCOUNT_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface IngestOutcome {
  url: string;
  status: "added" | "duplicate" | "rejected";
  reason?: string;
}

export interface IngestResult {
  added: number;
  duplicates: number;
  rejected: number;
  outcomes: IngestOutcome[];
}

/**
 * Why a scrape came back without this post.
 *
 * Facebook gets its own answers because its failures are different in kind and usually
 * fixable by the operator. There is no Facebook actor that takes a post URL, so a post is
 * found by scraping its page and matching — which means a link that doesn't name its page
 * (`/reel/{id}`, `/watch/?v={id}`) can't be looked up at all. Telling someone their post
 * "may have been deleted" when the real problem is the URL format sends them to check the
 * wrong thing.
 */
function notFoundReason(platform: TrackPlatformId, url: string): string {
  if (platform === "facebook") {
    if (!facebookPageFrom(url)) {
      return "That Facebook link names the post but not the page it's on, and Facebook has no post-by-URL scraper — so there's no page to look it up in. Open the post on facebook.com and copy the URL from the address bar (it should look like facebook.com/thepage/posts/...).";
    }
    return "Not found among that page's recent posts. It may have been deleted, made non-public, or posted by a different page than the URL suggests.";
  }
  return "The platform returned nothing for that link — it may be deleted, private, or age-restricted.";
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Add tracked posts to a campaign from pasted links.
 *
 * Takes an array from day one even though the UI passes exactly one URL. Bulk upload later
 * is then a spreadsheet parser in front of this same function — the same discipline the fan
 * page bulk-add follows, and the reason a bulk path can't quietly diverge from the single
 * one. (parseAgencySheet.ts is the existing precedent for that parser.)
 *
 * Per-URL outcomes rather than a thrown error on the first bad link: pasting ten links and
 * having the whole batch rejected because one was a story URL is the wrong behaviour.
 */
export async function ingestTrackedPostUrls(
  campaignId: string,
  urls: string[],
): Promise<IngestResult> {
  const outcomes: IngestOutcome[] = [];
  const parsed: { url: string; platform: TrackPlatformId; postKey: string; canonicalUrl: string }[] = [];

  // Dedup within the submitted batch itself by postKey, not by URL string — the same post
  // pasted as /p/ and /reel/, or twice with different tracking params, is one post.
  const seen = new Set<string>();
  for (const url of urls) {
    const result = parsePostUrl(url);
    if (!result.ok) {
      outcomes.push({ url, status: "rejected", reason: result.reason });
      continue;
    }
    const { platform, postKey, canonicalUrl } = result.value;
    const key = `${platform}:${postKey}`;
    if (seen.has(key)) {
      outcomes.push({ url, status: "duplicate", reason: "Same post appears twice in this batch." });
      continue;
    }
    seen.add(key);
    parsed.push({ url, platform, postKey, canonicalUrl });
  }

  // One query for the whole batch, not one per URL.
  const existing = await prisma.trackedPost.findMany({
    where: { OR: parsed.map((p) => ({ platform: p.platform as TrackPlatform, postKey: p.postKey })) },
    select: { platform: true, postKey: true, campaignId: true },
  });
  const existingKeys = new Map(existing.map((e) => [`${e.platform}:${e.postKey}`, e.campaignId]));

  const toScrape = parsed.filter((p) => {
    const owner = existingKeys.get(`${p.platform}:${p.postKey}`);
    if (owner === undefined) return true;
    outcomes.push({
      url: p.url,
      status: "duplicate",
      reason:
        owner === campaignId
          ? "Already tracked in this campaign."
          : "Already tracked under a different campaign.",
    });
    return false;
  });

  // Grouped by platform: each platform has its own actor/API and its own batch semantics.
  const byPlatform = new Map<TrackPlatformId, typeof toScrape>();
  for (const p of toScrape) {
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p);
    byPlatform.set(p.platform, list);
  }

  for (const [platform, items] of byPlatform) {
    const provider = getTrackedPostProvider(platform);
    for (const batch of chunk(items, SCRAPE_BATCH_SIZE)) {
      let scrapes: TrackedPostScrape[];
      try {
        scrapes = await provider.scrapePosts(
          platform,
          batch.map((b) => ({ postKey: b.postKey, url: b.canonicalUrl })),
        );
      } catch (err) {
        // A platform with no scraper (Facebook, §4a) or a quota trip fails the whole batch
        // rather than storing rows with no metrics. A tracked post that silently reports
        // zero is indistinguishable from a real zero and would corrupt every total.
        const reason =
          err instanceof PlatformNotSupportedError
            ? err.message
            : `Scrape failed: ${err instanceof Error ? err.message : String(err)}`;
        for (const b of batch) outcomes.push({ url: b.url, status: "rejected", reason });
        continue;
      }

      const byKey = new Map(scrapes.map((s) => [s.postKey, s]));
      for (const b of batch) {
        const scrape = byKey.get(b.postKey);
        if (!scrape) {
          outcomes.push({ url: b.url, status: "rejected", reason: notFoundReason(platform, b.canonicalUrl) });
          continue;
        }
        await storeTrackedPost(campaignId, platform, b.canonicalUrl, scrape);
        outcomes.push({ url: b.url, status: "added" });
      }
    }
  }

  return {
    added: outcomes.filter((o) => o.status === "added").length,
    duplicates: outcomes.filter((o) => o.status === "duplicate").length,
    rejected: outcomes.filter((o) => o.status === "rejected").length,
    outcomes,
  };
}

/**
 * Resolve (or create) the posting account, refresh its follower snapshot if stale, then
 * write the post row and its first metrics snapshot.
 *
 * The account is derived from the scrape, never typed in — the operator only pastes a link,
 * and the actor tells us who posted it.
 */
async function storeTrackedPost(
  campaignId: string,
  platform: TrackPlatformId,
  url: string,
  scrape: TrackedPostScrape,
): Promise<void> {
  const handle = scrape.authorHandle?.trim() || "unknown";
  const accountKey = accountKeyFor(platform, handle);

  // Looked up BEFORE the upsert only when the account is new. Inlining it as
  // `create: { scoutCandidateId: await findScoutCandidateId(...) }` would run the query on
  // every ingest — including every update, where the result is discarded — which is one
  // wasted round-trip per post on a path that is already query-heavy.
  const known = await prisma.trackedAccount.findUnique({
    where: { accountKey },
    select: { id: true },
  });

  const account = known
    ? await prisma.trackedAccount.update({
        where: { id: known.id },
        data: scrape.authorDisplayName ? { displayName: scrape.authorDisplayName } : {},
      })
    : await prisma.trackedAccount.create({
        data: {
          platform: platform as TrackPlatform,
          handle,
          displayName: scrape.authorDisplayName,
          accountKey,
          scoutCandidateId: await findScoutCandidateId(platform, handle),
        },
      });

  await refreshAccountSnapshotIfStale(account.id, platform, handle);

  const post = await prisma.trackedPost.upsert({
    where: { platform_postKey: { platform: platform as TrackPlatform, postKey: scrape.postKey } },
    create: {
      campaignId,
      accountId: account.id,
      platform: platform as TrackPlatform,
      url,
      postKey: scrape.postKey,
      mediaType: scrape.mediaType,
      caption: scrape.caption,
      postedAt: scrape.postedAt ? new Date(scrape.postedAt) : null,
      lastScrapedAt: new Date(),
      curLikes: scrape.likes,
      curComments: scrape.comments,
      curShares: scrape.shares,
      curViews: scrape.views,
    },
    // On a re-scrape the current figures shift into prev* so the UI can show movement
    // without reading the snapshot table for every card.
    update: {
      lastScrapedAt: new Date(),
      lastError: null,
      curLikes: scrape.likes,
      curComments: scrape.comments,
      curShares: scrape.shares,
      curViews: scrape.views,
    },
  });

  await prisma.trackedPostSnapshot.create({
    data: {
      trackedPostId: post.id,
      likes: scrape.likes,
      comments: scrape.comments,
      shares: scrape.shares,
      views: scrape.views,
      reactions: scrape.reactions ?? undefined,
      raw: scrape.raw as object,
    },
  });
}

/**
 * Find the Scoutline candidate this account corresponds to, if it was ever scouted. This
 * link is what makes the "did the paid post beat their own baseline" comparison possible,
 * so a silent miss here removes the single most useful number in the feature.
 *
 * Uses Scoutline's OWN `profileUrlKey` rather than this module's `accountKeyFor`, even
 * though the two produce identical output for ordinary handles. They are not identical in
 * general — Scoutline strips trailing dots (`someone.` -> `someone`) while accountKeyFor
 * strips a leading `@` — and the two normalizations drifting apart would break this lookup
 * without erroring: it would just return null forever and the baseline chip would quietly
 * never render. Calling the function that owns the format makes them impossible to drift.
 *
 * YouTube never matches — Scoutline covers Instagram and Facebook only. That is correct,
 * not a gap.
 */
async function findScoutCandidateId(platform: TrackPlatformId, handle: string): Promise<string | null> {
  if (platform === "youtube") return null;
  const candidate = await prisma.scoutCandidate.findUnique({
    where: { profileUrlKey: profileUrlKey(handle, platform) },
    select: { id: true },
  });
  return candidate?.id ?? null;
}

async function refreshAccountSnapshotIfStale(
  accountId: string,
  platform: TrackPlatformId,
  handle: string,
): Promise<void> {
  const latest = await prisma.trackedAccountSnapshot.findFirst({
    where: { accountId },
    orderBy: { capturedAt: "desc" },
    select: { capturedAt: true },
  });
  if (latest && Date.now() - latest.capturedAt.getTime() < ACCOUNT_SNAPSHOT_MAX_AGE_MS) return;

  try {
    const snap = await getTrackedPostProvider(platform).scrapeAccount(platform, handle);
    await prisma.trackedAccountSnapshot.create({
      data: {
        accountId,
        followers: snap.followers,
        followersAvailable: snap.followersAvailable,
        raw: (snap.raw ?? undefined) as object | undefined,
      },
    });
    if (snap.displayName) {
      await prisma.trackedAccount.update({
        where: { id: accountId },
        data: { displayName: snap.displayName },
      });
    }
  } catch (err) {
    // A missing follower count costs engagement rate for this account, not the post itself.
    // Swallowed rather than failing the ingest — the post's own metrics are the primary
    // deliverable and they scraped fine.
    console.error(`tracked account snapshot failed for ${platform}:${handle}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TrackedPostView {
  id: string;
  url: string;
  platform: TrackPlatformId;
  mediaType: string | null;
  caption: string | null;
  postedAt: Date | null;
  lastScrapedAt: Date | null;
  lastError: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  engagement: number | null;
  /** Movement since the previous scan. Null until a post has been scanned twice. */
  engagementDelta: number | null;
  engagementRatePct: number | null;
  commentRatio: number | null;
  viewRate: number | null;
  percentile: number | null;
  accountId: string;
  accountHandle: string;
}

export interface TrackedAccountView {
  id: string;
  handle: string;
  displayName: string | null;
  platform: TrackPlatformId;
  followers: number | null;
  followersAvailable: boolean;
  /** Scoutline's measured average engagement rate for this account, if it was scouted. */
  baselineErPct: number | null;
  baselineMeasuredAt: Date | null;
  /** This account's campaign posts' mean ER vs that baseline, as a percentage difference. */
  baselineDeltaPct: number | null;
  totals: AggregateTotals;
  posts: TrackedPostView[];
}

export interface CampaignTrackingView {
  campaign: { id: string; name: string };
  totals: AggregateTotals;
  accounts: TrackedAccountView[];
  posts: TrackedPostView[];
}

/**
 * Everything the tracker detail screen renders, in a fixed number of queries regardless of
 * how many posts or accounts the campaign has.
 *
 * Five queries total: campaign, posts, accounts, latest account snapshots, Scoutline
 * baselines. The last two are set-wide `findMany`s filtered by an id list, then indexed in
 * memory — NOT a lookup per account, which is the shape that breaks this app.
 */
export async function getCampaignTracking(campaignId: string): Promise<CampaignTrackingView | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true },
  });
  if (!campaign) return null;

  const postRows = await prisma.trackedPost.findMany({
    where: { campaignId },
    orderBy: [{ postedAt: "desc" }, { addedAt: "desc" }],
  });

  const accountIds = [...new Set(postRows.map((p) => p.accountId))];
  const accountRows = accountIds.length
    ? await prisma.trackedAccount.findMany({ where: { id: { in: accountIds } } })
    : [];

  // Latest follower snapshot per account, in ONE query. Ordered newest-first and reduced in
  // memory, rather than a findFirst per account.
  const snapshotRows = accountIds.length
    ? await prisma.trackedAccountSnapshot.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { capturedAt: "desc" },
        select: { accountId: true, followers: true, followersAvailable: true, capturedAt: true },
      })
    : [];
  const latestSnapshot = new Map<string, (typeof snapshotRows)[number]>();
  for (const s of snapshotRows) if (!latestSnapshot.has(s.accountId)) latestSnapshot.set(s.accountId, s);

  // Scoutline baselines, also in one query. See the baseline caveats in insights.ts.
  const scoutIds = accountRows.map((a) => a.scoutCandidateId).filter((id): id is string => Boolean(id));
  const scoutRows = scoutIds.length
    ? await prisma.scoutSnapshot.findMany({
        where: { candidateId: { in: scoutIds } },
        orderBy: { scrapedAt: "desc" },
        select: { candidateId: true, engagementRatePct: true, scrapedAt: true },
      })
    : [];
  const latestScout = new Map<string, (typeof scoutRows)[number]>();
  for (const s of scoutRows) if (!latestScout.has(s.candidateId)) latestScout.set(s.candidateId, s);

  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const allEngagement = postRows.map((p) => engagement({ likes: p.curLikes, comments: p.curComments }));

  const posts: TrackedPostView[] = postRows.map((p) => {
    const account = accountById.get(p.accountId);
    const snap = latestSnapshot.get(p.accountId);
    const followers = snap?.followersAvailable ? snap.followers : null;
    const current = engagement({ likes: p.curLikes, comments: p.curComments });
    const previous = engagement({ likes: p.prevLikes, comments: p.prevComments });
    return {
      id: p.id,
      url: p.url,
      platform: p.platform as TrackPlatformId,
      mediaType: p.mediaType,
      caption: p.caption,
      postedAt: p.postedAt,
      lastScrapedAt: p.lastScrapedAt,
      lastError: p.lastError,
      likes: p.curLikes,
      comments: p.curComments,
      shares: p.curShares,
      views: p.curViews,
      engagement: current,
      engagementDelta: current !== null && previous !== null ? current - previous : null,
      engagementRatePct: engagementRatePct({ likes: p.curLikes, comments: p.curComments }, followers),
      commentRatio: commentRatio({ likes: p.curLikes, comments: p.curComments }),
      viewRate: viewRate(p.curViews, followers),
      percentile: percentileRank(current, allEngagement),
      accountId: p.accountId,
      accountHandle: account?.handle ?? "unknown",
    };
  });

  const postsByAccount = new Map<string, TrackedPostView[]>();
  for (const p of posts) {
    const list = postsByAccount.get(p.accountId) ?? [];
    list.push(p);
    postsByAccount.set(p.accountId, list);
  }

  const accounts: TrackedAccountView[] = accountRows
    .map((a) => {
      const own = postsByAccount.get(a.id) ?? [];
      const snap = latestSnapshot.get(a.id);
      const scout = a.scoutCandidateId ? latestScout.get(a.scoutCandidateId) : undefined;

      // Mean ER across this account's campaign posts, compared against the mean ER across
      // ~100 of their own posts that Scoutline measured. Same formula on both sides — see
      // insights.ts baselineDeltaPct for why that equivalence is what makes this legitimate.
      const measuredErs = own.map((p) => p.engagementRatePct).filter((v): v is number => v !== null);
      const meanEr = measuredErs.length
        ? measuredErs.reduce((x, y) => x + y, 0) / measuredErs.length
        : null;

      return {
        id: a.id,
        handle: a.handle,
        displayName: a.displayName,
        platform: a.platform as TrackPlatformId,
        followers: snap?.followersAvailable ? snap.followers : null,
        followersAvailable: snap?.followersAvailable ?? false,
        baselineErPct: scout?.engagementRatePct ?? null,
        baselineMeasuredAt: scout?.scrapedAt ?? null,
        baselineDeltaPct: baselineDeltaPct(meanEr, scout?.engagementRatePct ?? null),
        totals: aggregate(
          own.map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
        ),
        posts: own,
      };
    })
    // Best-performing account first — the ordering the grid and the leaderboard both want.
    .sort((a, b) => (b.totals.engagement ?? -1) - (a.totals.engagement ?? -1));

  return {
    campaign,
    totals: aggregate(
      posts.map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
    ),
    accounts,
    posts,
  };
}

/** Campaigns that have tracked posts, with a count — the tracker index screen. */
export async function getTrackedCampaigns() {
  const grouped = await prisma.trackedPost.groupBy({
    by: ["campaignId"],
    _count: { _all: true },
  });
  const campaigns = await prisma.campaign.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true },
  });
  const counts = new Map(grouped.map((g) => [g.campaignId, g._count._all]));
  return campaigns.map((c) => ({ ...c, trackedPosts: counts.get(c.id) ?? 0 }));
}

/**
 * Re-scrape every active tracked post in a campaign, shifting current metrics into prev*
 * so the UI can show movement.
 *
 * Called from a Server Action wrapped in after(), never inline in a page render — a route
 * killed mid-wait orphans a billed Apify run (apify/client.ts).
 */
export async function refreshCampaignTracking(campaignId: string): Promise<{ refreshed: number; failed: number }> {
  const posts = await prisma.trackedPost.findMany({
    where: { campaignId, isActive: true },
    select: {
      id: true,
      platform: true,
      postKey: true,
      url: true,
      // Facebook needs this: it bounds the page scrape to the oldest post tracked there.
      postedAt: true,
      curLikes: true,
      curComments: true,
      curViews: true,
    },
  });

  let refreshed = 0;
  let failed = 0;

  const byPlatform = new Map<TrackPlatformId, typeof posts>();
  for (const p of posts) {
    const platform = p.platform as TrackPlatformId;
    const list = byPlatform.get(platform) ?? [];
    list.push(p);
    byPlatform.set(platform, list);
  }

  for (const [platform, items] of byPlatform) {
    const provider = getTrackedPostProvider(platform);
    for (const batch of chunk(items, SCRAPE_BATCH_SIZE)) {
      let scrapes: TrackedPostScrape[];
      try {
        scrapes = await provider.scrapePosts(
          platform,
          batch.map((b) => ({
            postKey: b.postKey,
            url: b.url,
            postedAt: b.postedAt ? b.postedAt.toISOString() : null,
          })),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.trackedPost.updateMany({
          where: { id: { in: batch.map((b) => b.id) } },
          data: { lastError: message, lastScrapedAt: new Date() },
        });
        failed += batch.length;
        continue;
      }

      const byKey = new Map(scrapes.map((s) => [s.postKey, s]));
      for (const b of batch) {
        const s = byKey.get(b.postKey);
        if (!s) {
          await prisma.trackedPost.update({
            where: { id: b.id },
            data: {
              lastScrapedAt: new Date(),
              lastError: notFoundReason(platform, b.url),
            },
          });
          failed++;
          continue;
        }
        await prisma.trackedPost.update({
          where: { id: b.id },
          data: {
            lastScrapedAt: new Date(),
            lastError: null,
            prevLikes: b.curLikes,
            prevComments: b.curComments,
            prevViews: b.curViews,
            curLikes: s.likes,
            curComments: s.comments,
            curShares: s.shares,
            curViews: s.views,
          },
        });
        await prisma.trackedPostSnapshot.create({
          data: {
            trackedPostId: b.id,
            likes: s.likes,
            comments: s.comments,
            shares: s.shares,
            views: s.views,
            reactions: s.reactions ?? undefined,
            raw: s.raw as object,
          },
        });
        refreshed++;
      }
    }
  }

  return { refreshed, failed };
}

/** Engagement history for one post — the only read path that touches the snapshot table. */
export async function getTrackedPostTrend(trackedPostId: string) {
  const snaps = await prisma.trackedPostSnapshot.findMany({
    where: { trackedPostId },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, likes: true, comments: true, views: true },
  });
  return snaps.map((s, i) => {
    const current = { engagement: engagement({ likes: s.likes, comments: s.comments }), at: s.capturedAt };
    const prior = i > 0 ? snaps[i - 1] : null;
    return {
      capturedAt: s.capturedAt,
      engagement: current.engagement,
      views: s.views,
      velocityPerDay: prior
        ? velocityPerDay(current, {
            engagement: engagement({ likes: prior.likes, comments: prior.comments }),
            at: prior.capturedAt,
          })
        : null,
    };
  });
}

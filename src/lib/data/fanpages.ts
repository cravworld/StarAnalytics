import { prisma } from "@/lib/prisma";
import { fetchProfileSnapshot, backfillFanPageLink } from "@/lib/providers/apify-public-content";
import { PLATFORM_HANDLE_VALIDATORS, contentProviderFor } from "@/lib/providers/platform-utils";
import type { PlatformId, RawPost } from "@/lib/providers/types";
import { getFollowerTrends, lookupTrend, recordAccountSnapshot } from "@/lib/data/accountSnapshots";
import { AVATAR_PALETTE as SHARED_AVATAR_PALETTE } from "@/lib/palette";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

// Same hash-based deterministic assignment pattern as campaigns.ts's ICON_PALETTE —
// stable across renders/requests without persisting a colour choice anywhere.
// Colours come from lib/palette.ts; the length is unchanged so the hash-based
// assignment below still gives every page the same slot it had before.
const AVATAR_PALETTE = SHARED_AVATAR_PALETTE;

function avatarFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const SPARK_DAYS = 7;
// A fan page counts as "actively posting a tracked tag" if it's authored at least one
// post linked to a live campaign — recency isn't required, this is a coverage signal.
const RECENT_POSTS_FOR_ENG_SAMPLE = 20;

async function fanPageRow(
  page: {
    id: string;
    platform: PlatformId;
    igHandle: string;
    displayName: string | null;
    followers: number | null;
    isVerifiedFan: boolean;
  },
  trend: { values: number[]; deltaPct: number | null },
) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sparkStart = new Date(startOfToday.getTime() - (SPARK_DAYS - 1) * 24 * 60 * 60 * 1000);

  const [postsToday, recentPosts, sparkPosts, trackedTagPost, lastPost] = await Promise.all([
    prisma.post.count({ where: { fanPageId: page.id, postedAt: { gte: startOfToday } } }),
    prisma.post.findMany({
      where: { fanPageId: page.id },
      orderBy: { postedAt: "desc" },
      take: RECENT_POSTS_FOR_ENG_SAMPLE,
      select: { likes: true, comments: true },
    }),
    prisma.post.findMany({
      where: { fanPageId: page.id, postedAt: { gte: sparkStart } },
      select: { postedAt: true },
    }),
    prisma.post.findFirst({ where: { fanPageId: page.id, campaignId: { not: null } }, select: { id: true } }),
    prisma.post.findFirst({ where: { fanPageId: page.id }, orderBy: { postedAt: "desc" }, select: { postedAt: true } }),
  ]);

  const engTotal = recentPosts.reduce((s, p) => s + (p.likes ?? 0) + (p.comments ?? 0), 0);
  const engRate =
    page.followers && page.followers > 0 && recentPosts.length > 0
      ? (engTotal / recentPosts.length / page.followers) * 100
      : 0;

  const dayBuckets = new Array(SPARK_DAYS).fill(0);
  for (const p of sparkPosts) {
    if (!p.postedAt) continue;
    const dayIdx = Math.floor((p.postedAt.getTime() - sparkStart.getTime()) / (24 * 60 * 60 * 1000));
    if (dayIdx >= 0 && dayIdx < SPARK_DAYS) dayBuckets[dayIdx]++;
  }
  const maxBucket = Math.max(1, ...dayBuckets);
  const spark = dayBuckets.map((c) => Math.round((c / maxBucket) * 100));

  const status = lastPost?.postedAt ? now.getTime() - lastPost.postedAt.getTime() < 24 * 60 * 60 * 1000 : false;
  const { bg, c } = avatarFor(page.id);
  const displayName = page.displayName ?? page.igHandle;

  return {
    name: displayName,
    platform: page.platform,
    handle: `@${page.igHandle}`,
    bg,
    c,
    init: initials(displayName),
    followers: fmtCompact(page.followers ?? 0),
    followersRaw: page.followers ?? 0,
    eng: `${engRate.toFixed(1)}%`,
    engRaw: engRate,
    posts: `${postsToday} post${postsToday === 1 ? "" : "s"}`,
    postsTodayRaw: postsToday,
    status,
    spark,
    vijayam: Boolean(trackedTagPost),
    isVerifiedFan: page.isVerifiedFan,
    // Real follower-count history (see AccountSnapshot) — distinct from `spark` above, which
    // is posting frequency, not follower growth. Instagram fan pages have no periodic refresh
    // (see recordAccountSnapshot's call site comments), so this stays a single point for them
    // today; YouTube fan pages get a real trend from their TTL refresh.
    followerTrend: trend.values,
    followerTrendDeltaPct: trend.deltaPct,
  };
}

export async function getFanPagesData() {
  const activePages = await prisma.fanPage.findMany({ where: { isActive: true }, orderBy: { igHandle: "asc" } });

  const totalTracked = activePages.length;
  const totalReachRaw = activePages.reduce((s, p) => s + (p.followers ?? 0), 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [activeTodayCount, coverageCount, alertRows] = await Promise.all([
    prisma.post.groupBy({
      by: ["fanPageId"],
      where: { fanPageId: { not: null }, postedAt: { gte: todayStart } },
    }),
    prisma.post.groupBy({
      by: ["fanPageId"],
      where: { fanPageId: { not: null }, campaignId: { not: null } },
    }),
    prisma.alert.findMany({
      where: { fanPageId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { fanPage: true },
    }),
  ]);

  const trends = await getFollowerTrends(activePages.map((p) => ({ platform: p.platform, igHandle: p.igHandle })));
  const fanPages = await Promise.all(
    activePages.map((p) => fanPageRow(p, lookupTrend(trends, p.platform, p.igHandle))),
  );

  // fanPageAlerts.ts builds message as "<igHandle> posted ..." (no @ prefix) —
  // split it back into a bold handle + plain-text remainder for the UI, rather than
  // storing the two separately (message stays a single self-contained sentence).
  const alerts = alertRows.map((a) => {
    const bold = a.fanPage ? `@${a.fanPage.igHandle}` : "Fan page";
    const text = a.fanPage && a.message.startsWith(a.fanPage.igHandle)
      ? a.message.slice(a.fanPage.igHandle.length)
      : ` ${a.message}`;
    return { icon: "🔔", prefix: undefined as string | undefined, bold, text, time: relativeTime(a.createdAt), dim: !!a.deliveredAt };
  });

  return {
    fanPages,
    totalTracked,
    kpis: {
      totalReach: fmtCompact(totalReachRaw),
      activeToday: `${activeTodayCount.length}/${totalTracked || 0}`,
      postingCampaignTags: `${coverageCount.length}/${totalTracked || 0}`,
    },
    alerts,
    suggestions: await getSuggestedFanPages(),
  };
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / (60 * 1000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// Repeat posters of a live campaign's tracked hashtags, not yet a tracked FanPage —
// purely derived from existing posts data, no persistence and no Apify cost until
// someone clicks Add (see AGENTS.md/plan §"Suggested fan pages" — suggest, don't auto-add).
const MIN_POSTS_FOR_SUGGESTION = 2;

export async function getSuggestedFanPages(): Promise<{ handle: string; postCount: number }[]> {
  const rows = await prisma.$queryRaw<{ author_handle: string; post_count: bigint }[]>`
    SELECT author_handle, count(*) as post_count
    FROM posts
    WHERE campaign_id IS NOT NULL
      AND author_handle IS NOT NULL
      AND lower(author_handle) NOT IN (SELECT lower(ig_handle) FROM fan_pages)
    GROUP BY author_handle
    HAVING count(*) >= ${MIN_POSTS_FOR_SUGGESTION}
    ORDER BY count(*) DESC
    LIMIT 10
  `;
  return rows.map((r) => ({ handle: r.author_handle, postCount: Number(r.post_count) }));
}

const FAN_PAGE_SCRAPE_TTL_HOURS = 12;

function isStale(lastCheckedAt: Date | null): boolean {
  if (!lastCheckedAt) return true;
  return Date.now() - lastCheckedAt.getTime() > FAN_PAGE_SCRAPE_TTL_HOURS * 60 * 60 * 1000;
}

// Instagram fan pages get posts linked passively (backfillFanPageLink at add-time, then
// activeFanPageMap during hashtag scrapes going forward) — there's a real ongoing pipeline
// to piggyback on. YouTube has no equivalent (its hashtag/campaign tracking is out of
// scope, see the multi-platform migration notes), so a YouTube fan channel needs its own
// posts pulled directly from its own uploads — same mechanism as Compare's competitor
// tracking, just linked via fanPageId instead of competitorId.
async function storeFanPagePosts(fanPageId: string, posts: RawPost[]): Promise<void> {
  for (const p of posts) {
    if (!p.igShortcode) continue;
    await prisma.post.upsert({
      where: { platform_igShortcode: { platform: p.platform, igShortcode: p.igShortcode } },
      create: {
        source: "fanpage",
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
        raw: p.raw as object,
        fanPageId,
      },
      update: {
        externalUrl: p.externalUrl,
        mediaType: p.mediaType,
        caption: p.caption,
        postedAt: new Date(p.postedAt),
        reach: p.reach,
        likes: p.likes,
        comments: p.comments,
        raw: p.raw as object,
        fanPageId,
        scrapedAt: new Date(),
      },
    });
  }
}

// The only place a real channel scrape happens for a YouTube fan page — called from
// addFanPage (first add) and refreshStaleFanPages (cron, TTL-gated), never from render.
async function scrapeYouTubeFanChannel(handle: string): Promise<void> {
  const snapshot = await contentProviderFor("youtube").scrapeByHandle(handle);
  const fanPage = await prisma.fanPage.upsert({
    where: { platform_igHandle: { platform: "youtube", igHandle: snapshot.handle } },
    create: { platform: "youtube", igHandle: snapshot.handle, displayName: snapshot.displayName, followers: snapshot.followers, lastCheckedAt: new Date() },
    update: { displayName: snapshot.displayName, followers: snapshot.followers, lastCheckedAt: new Date() },
  });
  await storeFanPagePosts(fanPage.id, snapshot.posts);
  // Same follower count already fetched above — no new Apify call. Every scrape (first add +
  // every TTL refresh, see refreshStaleFanPages) adds one history point.
  await recordAccountSnapshot("youtube", snapshot.handle, snapshot.followers);
}

// Manual add, or promoting a suggestion — same code path either way for Instagram.
// Instagram: spends the one Apify profile-only call this action costs, then backfills
// fanPageId onto any posts already scraped under this handle (relies on the ongoing
// hashtag-pipeline linkage going forward). YouTube: pulls the channel's own uploads
// directly (no hashtag pipeline to lean on — see storeFanPagePosts above).
export async function addFanPage(handleInput: string, platform: PlatformId = "instagram"): Promise<void> {
  const handle = handleInput.replace(/^@/, "").trim();
  if (!handle) throw new Error("handle is required");
  const validator = PLATFORM_HANDLE_VALIDATORS[platform];
  if (!validator.pattern.test(handle)) throw new Error(`not a valid ${validator.label} handle`);

  const existing = await prisma.fanPage.findUnique({ where: { platform_igHandle: { platform, igHandle: handle } } });
  if (existing) {
    if (!existing.isActive) {
      await prisma.fanPage.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return;
  }

  if (platform === "youtube") {
    await scrapeYouTubeFanChannel(handle);
    return;
  }

  const snapshot = await fetchProfileSnapshot(handle);
  const fanPage = await prisma.fanPage.create({
    data: { igHandle: handle, displayName: snapshot.displayName, followers: snapshot.followers, lastCheckedAt: new Date() },
  });
  await backfillFanPageLink(handle, fanPage.id);
  // Instagram fan pages have no periodic refresh (see refreshStaleFanPages's own comment on
  // why — they update passively via the hashtag pipeline instead), so this add-time snapshot
  // is the only point they'll ever get today. Recorded anyway: harmless, costs nothing, and
  // gives a real starting point if a refresh path is ever added for them.
  await recordAccountSnapshot("instagram", handle, snapshot.followers);
}

// Called only from the polling cron — refreshes any tracked YouTube fan channel whose
// data is past the TTL. Instagram fan pages are deliberately excluded: they update
// passively through the hashtag-scrape pipeline and have never needed (or had) their own
// refresh path. One channel's scrape failing shouldn't block the others, same discipline
// as refreshStaleCompetitors.
export async function refreshStaleFanPages(): Promise<{ handle: string; ok: boolean; error?: string }[]> {
  const youtubePages = await prisma.fanPage.findMany({ where: { platform: "youtube", isActive: true } });
  const results: { handle: string; ok: boolean; error?: string }[] = [];
  for (const p of youtubePages) {
    if (!isStale(p.lastCheckedAt)) continue;
    try {
      await scrapeYouTubeFanChannel(p.igHandle);
      results.push({ handle: p.igHandle, ok: true });
    } catch (err) {
      results.push({ handle: p.igHandle, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

import { isApifyQuotaFailure } from "@/lib/apify/quotaBreaker";
import { prisma } from "@/lib/prisma";
import { backfillFanPageLink } from "@/lib/providers/apify-public-content";
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
// The window the "Most Active" tab ranks on. Deliberately much wider than the 24h
// `status` dot: an Instagram fan page only accrues posts when a tracked-hashtag scrape
// happens to catch one, so "posted today" is zero for almost every page almost always —
// ranking on it produced a permanently empty tab. 30 days is long enough that a genuinely
// active page always registers, while still being short enough to mean "active".
const ACTIVITY_WINDOW_DAYS = 30;

/**
 * One row of the fan-page list.
 *
 * Declared explicitly rather than inferred from the function below, and re-exported to the
 * list component as its prop type, so the screen and the query can't drift apart. Inference
 * alone did not survive this object growing: the page component ended up mapping over
 * `any[]`, which the build rejects under noImplicitAny.
 */
export interface FanPageListRow {
  id: string;
  name: string;
  platform: PlatformId;
  handle: string;
  bg: string;
  c: string;
  init: string;
  followers: string;
  followersRaw: number;
  eng: string;
  engRaw: number;
  posts: string;
  postsTodayRaw: number;
  postsInWindow: number;
  activityWindowDays: number;
  lastPostAtMs: number | null;
  lastPostLabel: string | null;
  status: boolean;
  spark: number[];
  vijayam: boolean;
  isVerifiedFan: boolean;
  followerTrend: number[];
  followerTrendDeltaPct: number | null;
}

export interface FanPageAlertRow {
  icon: string;
  prefix: string | undefined;
  bold: string;
  text: string;
  time: string;
  dim: boolean;
}

export interface FanPagesData {
  fanPages: FanPageListRow[];
  totalTracked: number;
  kpis: { totalReach: string; activeToday: string; postingCampaignTags: string };
  alerts: FanPageAlertRow[];
  suggestions: { handle: string; postCount: number }[];
}

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
): Promise<FanPageListRow> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sparkStart = new Date(startOfToday.getTime() - (SPARK_DAYS - 1) * 24 * 60 * 60 * 1000);
  const activityStart = new Date(startOfToday.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);

  const [postsToday, recentPosts, sparkPosts, trackedTagPost, lastPost, postsInWindow] = await Promise.all([
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
    prisma.post.count({ where: { fanPageId: page.id, postedAt: { gte: activityStart } } }),
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
    id: page.id,
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
    // What "Most Active" actually ranks on — see ACTIVITY_WINDOW_DAYS.
    postsInWindow,
    activityWindowDays: ACTIVITY_WINDOW_DAYS,
    // Recency fallback so the ranking still orders pages that all have zero posts in the
    // window: least-stale first, rather than an arbitrary tie.
    lastPostAtMs: lastPost?.postedAt ? lastPost.postedAt.getTime() : null,
    lastPostLabel: lastPost?.postedAt ? `${relativeTime(lastPost.postedAt)} ago` : null,
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

export async function getFanPagesData(): Promise<FanPagesData> {
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

// ── Detail view ───────────────────────────────────────────────────────────────────
// Everything one fan page's own screen needs, in a single call. Strictly read-only:
// every number below comes from rows already in the database. The only thing that puts
// new rows there is pullFanPageHistory() further down, which is an explicit button press
// — never a render-time side effect. That split is the whole reason a detail screen can
// be opened freely without anyone worrying what it costs (APIFY-USAGE-AUDIT.md).

const TOP_POSTS = 10;
const CADENCE_DAYS = 30;
const RECENT_COMMENTS = 12;
// 6 slots of 4 hours, which is the shape the audience screen's heatmap CSS already
// expects (.heat-cell + .h0–.h4) — reused rather than inventing a second grid.
const HEATMAP_SLOTS = 6;
const HEATMAP_SLOT_HOURS = 24 / HEATMAP_SLOTS;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function engagementOf(p: { likes: number | null; comments: number | null }): number {
  return (p.likes ?? 0) + (p.comments ?? 0);
}

// Spelled out rather than left to inference. getFanPageDetail returns a wide object built
// from several Prisma queries, and inferring the whole thing left this array as `any[]` by
// the time the page component mapped over it — which the app builds under noImplicitAny
// and rejects. An explicit row type is also the honest contract for a data-layer export.
export interface FanPagePostRow {
  id: string;
  shortcode: string | null;
  externalUrl: string | null;
  mediaType: string | null;
  caption: string;
  postedAtMs: number | null;
  postedLabel: string | null;
  likes: number | null;
  comments: number | null;
  /** Null on Instagram by design — see the note at the assignment site. */
  reach: number | null;
  engagement: number;
  campaignName: string | null;
  sentimentLabel: "pos" | "neu" | "neg" | null;
  storedComments: number;
}

/** JS getDay() is Sunday-first; the heatmap reads Mon–Sun like a diary week. */
function mondayFirstIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export interface FanPageDetail {
  id: string;
  platform: PlatformId;
  handle: string;
  displayName: string;
  isActive: boolean;
  isVerifiedFan: boolean;
  followers: number;
  followersDisplay: string;
  followerTrend: number[];
  followerTrendDeltaPct: number | null;
  lastCheckedLabel: string | null;
  isStale: boolean;
  avatar: { bg: string; c: string };
  initials: string;
  kpis: {
    totalPosts: number;
    avgLikes: number;
    avgComments: number;
    engRate: number;
    postsPerWeek: number;
    totalEngagement: number;
    campaignPosts: number;
    storedComments: number;
  };
  cadence: number[];
  cadenceDays: number;
  /** One row per weekday, Mon-first; `slots` are the 0–4 intensities the .h0–.h4 CSS wants. */
  heatmap: { day: string; slots: number[] }[];
  campaignContribution: { campaignId: string; name: string; posts: number; engagement: number }[];
  postSentiment: { pos: number; neu: number; neg: number; unclassified: number };
  commentSentiment: { pos: number; neu: number; neg: number };
  topPosts: FanPagePostRow[];
  posts: FanPagePostRow[];
  recentComments: {
    id: string;
    authorHandle: string | null;
    text: string;
    postedLabel: string | null;
    sentimentLabel: "pos" | "neu" | "neg" | null;
  }[];
  alerts: { id: string; type: string; message: string; time: string; delivered: boolean; channel: string | null }[];
}

export async function getFanPageDetail(id: string): Promise<FanPageDetail | null> {
  const page = await prisma.fanPage.findUnique({ where: { id } });
  if (!page) return null;

  const [posts, alertRows, trends] = await Promise.all([
    prisma.post.findMany({
      where: { fanPageId: id },
      orderBy: { postedAt: "desc" },
      include: {
        campaign: { select: { id: true, name: true } },
        sentiment: { select: { label: true } },
        _count: { select: { postComments: true } },
      },
    }),
    prisma.alert.findMany({ where: { fanPageId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    getFollowerTrends([{ platform: page.platform, igHandle: page.igHandle }]),
  ]);
  const trend = lookupTrend(trends, page.platform, page.igHandle);
  const postIds = posts.map((p) => p.id);

  const [commentSentimentRows, recentComments] = await Promise.all([
    prisma.commentSentiment.groupBy({
      by: ["label"],
      where: { postComment: { postId: { in: postIds } } },
      _count: { _all: true },
    }),
    // Comment text is nulled by the prune-raw-payloads cron once COMMENT_RETENTION_DAYS
    // has passed (DATA-PRIVACY.md "Retention"), so this deliberately asks only for rows
    // that still have text — an older post contributes to the counts above but has
    // nothing quotable left, which is the intended behaviour, not missing data.
    prisma.postComment.findMany({
      where: { postId: { in: postIds }, text: { not: null } },
      orderBy: { postedAt: "desc" },
      take: RECENT_COMMENTS,
      select: { id: true, authorHandle: true, text: true, postedAt: true, sentiment: { select: { label: true } } },
    }),
  ]);

  // ── Headline metrics. Same derivations as compare.ts's competitorColumn so a fan page
  // and a competitor are measured identically — deliberately not re-invented here.
  const followers = page.followers ?? 0;
  const sample = posts.slice(0, RECENT_POSTS_FOR_ENG_SAMPLE);
  const avgLikes = sample.length ? sample.reduce((s, p) => s + (p.likes ?? 0), 0) / sample.length : 0;
  const avgComments = sample.length ? sample.reduce((s, p) => s + (p.comments ?? 0), 0) / sample.length : 0;
  const engRate = followers > 0 && sample.length ? ((avgLikes + avgComments) / followers) * 100 : 0;

  const postedDates = posts.map((p) => p.postedAt).filter((d): d is Date => d !== null);
  let postsPerWeek = 0;
  if (postedDates.length >= 2) {
    const newest = Math.max(...postedDates.map((d) => d.getTime()));
    const oldest = Math.min(...postedDates.map((d) => d.getTime()));
    const spanWeeks = (newest - oldest) / (7 * 24 * 60 * 60 * 1000);
    postsPerWeek = spanWeeks > 0 ? postedDates.length / spanWeeks : postedDates.length;
  } else if (postedDates.length === 1) {
    postsPerWeek = 1;
  }

  // ── 30-day posting cadence (one bar per day) and a day × time-of-day heatmap.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const cadenceStart = new Date(startOfToday.getTime() - (CADENCE_DAYS - 1) * 24 * 60 * 60 * 1000);
  const cadence = new Array(CADENCE_DAYS).fill(0);
  const heatCounts: number[][] = DAY_LABELS.map(() => new Array(HEATMAP_SLOTS).fill(0));
  for (const d of postedDates) {
    const dayIdx = Math.floor((d.getTime() - cadenceStart.getTime()) / (24 * 60 * 60 * 1000));
    if (dayIdx >= 0 && dayIdx < CADENCE_DAYS) cadence[dayIdx]++;
    heatCounts[mondayFirstIndex(d)][Math.floor(d.getHours() / HEATMAP_SLOT_HOURS)]++;
  }
  // Scale to the 0–4 intensity buckets the .h0–.h4 CSS classes define. An all-zero
  // heatmap stays all-zero rather than lighting up on a max of 1.
  const heatMax = Math.max(0, ...heatCounts.flat());
  const heatmap = DAY_LABELS.map((day, i) => ({
    day,
    slots: heatCounts[i].map((c) => (heatMax === 0 ? 0 : Math.ceil((c / heatMax) * 4))),
  }));

  // ── Which of your campaigns this page has actually amplified.
  const byCampaign = new Map<string, { name: string; posts: number; engagement: number }>();
  for (const p of posts) {
    if (!p.campaign) continue;
    const row = byCampaign.get(p.campaign.id) ?? { name: p.campaign.name, posts: 0, engagement: 0 };
    row.posts++;
    row.engagement += engagementOf(p);
    byCampaign.set(p.campaign.id, row);
  }
  const campaignContribution = [...byCampaign.entries()]
    .map(([campaignId, v]) => ({ campaignId, ...v }))
    .sort((a, b) => b.posts - a.posts);

  const postSentiment = { pos: 0, neu: 0, neg: 0, unclassified: 0 };
  for (const p of posts) {
    if (p.sentiment) postSentiment[p.sentiment.label]++;
    else postSentiment.unclassified++;
  }

  const commentSentiment = { pos: 0, neu: 0, neg: 0 };
  for (const r of commentSentimentRows) commentSentiment[r.label] = r._count._all;

  const postRows: FanPagePostRow[] = posts.map((p) => ({
    id: p.id,
    shortcode: p.igShortcode,
    externalUrl: p.externalUrl,
    mediaType: p.mediaType,
    caption: p.caption ?? "",
    postedAtMs: p.postedAt ? p.postedAt.getTime() : null,
    postedLabel: p.postedAt ? p.postedAt.toISOString().slice(0, 10) : null,
    likes: p.likes,
    comments: p.comments,
    // Instagram never collects reach (the actor bills it behind a detail tier this
    // integration deliberately doesn't buy — see apify-normalize.ts); YouTube's holds a
    // real public view count. Left null rather than zero so the UI can render the
    // "unavailable" em-dash instead of a fabricated number.
    reach: p.reach,
    engagement: engagementOf(p),
    campaignName: p.campaign?.name ?? null,
    sentimentLabel: p.sentiment?.label ?? null,
    storedComments: p._count.postComments,
  }));

  const totalEngagement = posts.reduce((s, p) => s + engagementOf(p), 0);

  return {
    id: page.id,
    platform: page.platform as PlatformId,
    handle: page.igHandle,
    displayName: page.displayName ?? page.igHandle,
    isActive: page.isActive,
    isVerifiedFan: page.isVerifiedFan,
    followers,
    followersDisplay: fmtCompact(followers),
    followerTrend: trend.values,
    followerTrendDeltaPct: trend.deltaPct,
    lastCheckedLabel: page.lastCheckedAt ? `${relativeTime(page.lastCheckedAt)} ago` : null,
    // Drives the "pull history" button's own copy — a page that has never been pulled
    // reads differently from one pulled an hour ago.
    isStale: isStale(page.lastCheckedAt),
    avatar: avatarFor(page.id),
    initials: initials(page.displayName ?? page.igHandle),
    kpis: {
      totalPosts: posts.length,
      avgLikes: Math.round(avgLikes),
      avgComments: Math.round(avgComments),
      engRate: Math.round(engRate * 100) / 100,
      postsPerWeek: Math.round(postsPerWeek * 10) / 10,
      totalEngagement,
      campaignPosts: posts.filter((p) => p.campaignId).length,
      storedComments: posts.reduce((s, p) => s + p._count.postComments, 0),
    },
    cadence,
    cadenceDays: CADENCE_DAYS,
    heatmap,
    campaignContribution,
    postSentiment,
    commentSentiment,
    topPosts: [...postRows].sort((a, b) => b.engagement - a.engagement).slice(0, TOP_POSTS),
    posts: postRows,
    recentComments: recentComments.map((c) => ({
      id: c.id,
      authorHandle: c.authorHandle,
      text: c.text ?? "",
      postedLabel: c.postedAt ? `${relativeTime(c.postedAt)} ago` : null,
      sentimentLabel: c.sentiment?.label ?? null,
    })),
    alerts: alertRows.map((a) => ({
      id: a.id,
      type: a.type,
      message: a.message,
      time: `${relativeTime(a.createdAt)} ago`,
      delivered: Boolean(a.deliveredAt),
      channel: a.channel,
    })),
  };
}

const FAN_PAGE_SCRAPE_TTL_HOURS = 12;

function isStale(lastCheckedAt: Date | null): boolean {
  if (!lastCheckedAt) return true;
  return Date.now() - lastCheckedAt.getTime() > FAN_PAGE_SCRAPE_TTL_HOURS * 60 * 60 * 1000;
}

// Stores a fan page's own posts and links them to it. Returns the stored post ids so the
// caller can hand them to the sentiment pipeline — without that, freshly pulled posts sat
// unclassified until some unrelated cron happened to sweep them up.
async function storeFanPagePosts(fanPageId: string, posts: RawPost[]): Promise<string[]> {
  const ids: string[] = [];
  for (const p of posts) {
    if (!p.igShortcode) continue;
    const stored = await prisma.post.upsert({
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
      select: { id: true },
    });
    ids.push(stored.id);
  }
  return ids;
}

// The one real scrape path for a fan page, on either platform: profile + that page's own
// recent posts (capped at 50 per platform — see MAX_RECENT_VIDEOS and
// APIFY_HANDLE_POSTS_LIMIT; deeper history is stale for the questions this app asks),
// stored, linked, and given a follower-history point.
//
// Every caller goes through here — the first add, the detail screen's manual pull, and the
// TTL cron — so there is one behaviour to reason about rather than three that can drift.
// Never called from render: it costs real money on Instagram.
async function scrapeFanPageFull(
  platform: PlatformId,
  handle: string,
): Promise<{ fanPageId: string; postIds: string[] }> {
  const snapshot = await contentProviderFor(platform).scrapeByHandle(handle);
  const fanPage = await prisma.fanPage.upsert({
    where: { platform_igHandle: { platform, igHandle: snapshot.handle } },
    create: {
      platform,
      igHandle: snapshot.handle,
      displayName: snapshot.displayName,
      followers: snapshot.followers,
      lastCheckedAt: new Date(),
    },
    update: { displayName: snapshot.displayName, followers: snapshot.followers, lastCheckedAt: new Date() },
  });
  const postIds = await storeFanPagePosts(fanPage.id, snapshot.posts);
  // Instagram only: claims any posts already scraped under this handle by the hashtag
  // pipeline before it was tracked (or since, under a different source). A no-op on
  // YouTube, which has no hashtag pipeline feeding it.
  if (platform === "instagram") await backfillFanPageLink(snapshot.handle, fanPage.id);
  // Same follower count already fetched above — no extra call. Every scrape adds one
  // history point, which is what makes the follower trend on the detail screen real.
  await recordAccountSnapshot(platform, snapshot.handle, snapshot.followers);
  return { fanPageId: fanPage.id, postIds };
}

// Re-pull one tracked fan page on demand — the detail screen's refresh button. Returns the
// stored post ids so the caller can queue sentiment classification for them.
export async function pullFanPageHistory(id: string): Promise<{ postIds: string[]; postCount: number }> {
  const page = await prisma.fanPage.findUnique({ where: { id } });
  if (!page) throw new Error("fan page not found");
  const { postIds } = await scrapeFanPageFull(page.platform, page.igHandle);
  return { postIds, postCount: postIds.length };
}

export async function setFanPageVerified(id: string, isVerifiedFan: boolean): Promise<void> {
  await prisma.fanPage.update({ where: { id }, data: { isVerifiedFan } });
}

// Soft delete, mirroring removeCompetitor: isActive:false drops the page out of every
// list, KPI and scrape path, but keeps its posts and their campaign attribution intact —
// a hard delete would silently rewrite the history of campaigns this page contributed to.
// addFanPage re-activates the same row if the handle is ever added back.
export async function stopTrackingFanPage(id: string): Promise<void> {
  await prisma.fanPage.update({ where: { id }, data: { isActive: false } });
}

// Manual add, or promoting a suggestion — one code path, both platforms.
//
// This used to be profile-only for Instagram (followers + display name, ~$0.0023) on the
// theory that a new page's post history would accumulate for free from the hashtag stream.
// In practice it barely did: the hashtag pipeline only ever links a fan page's post if that
// post happens to carry a tracked tag, so a newly added page sat at zero or one posts
// indefinitely and every per-page metric read as empty. It now does the same full pull as
// every other path (scrapeFanPageFull) so a page has real content the moment it is added.
//
// Returns the ids of any posts stored, for the caller to queue sentiment on. Empty for a
// re-activated page, which stores nothing new.
export async function addFanPage(handleInput: string, platform: PlatformId = "instagram"): Promise<string[]> {
  const handle = handleInput.replace(/^@/, "").trim();
  if (!handle) throw new Error("handle is required");
  const validator = PLATFORM_HANDLE_VALIDATORS[platform];
  if (!validator.pattern.test(handle)) throw new Error(`not a valid ${validator.label} handle`);

  const existing = await prisma.fanPage.findUnique({ where: { platform_igHandle: { platform, igHandle: handle } } });
  if (existing) {
    if (!existing.isActive) {
      await prisma.fanPage.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return [];
  }

  const { postIds } = await scrapeFanPageFull(platform, handle);
  return postIds;
}

// Called from the polling cron — refreshes every tracked fan page past the TTL, on both
// platforms.
//
// Instagram used to be excluded here on the grounds that the hashtag pipeline kept it
// current. It doesn't: that pipeline only touches a fan page's post if the post carries a
// tracked tag, and it never revisits the profile at all, so an Instagram page's follower
// count stayed frozen at whatever it was on the day it was added and its follower trend
// could never have more than the single add-time point. Including it here is what makes
// the trend line and the growth delta real on Instagram rather than YouTube-only.
//
// One page failing must not block the others, same discipline as refreshStaleCompetitors.
//
// `apifyQuotaExhausted` lets the caller pass in what it already learned this tick — the
// poll-hashtags cron usually hits the Apify cap during hashtag scraping, long before it
// gets here, and without this every Instagram page would burn one more doomed call to
// rediscover it. YouTube pages ignore the flag entirely: separate API, separate quota.
export async function refreshStaleFanPages(
  apifyQuotaExhausted = false,
): Promise<{ handle: string; ok: boolean; error?: string }[]> {
  const pages = await prisma.fanPage.findMany({ where: { isActive: true } });
  const results: { handle: string; ok: boolean; error?: string }[] = [];
  let quotaExhausted = apifyQuotaExhausted;
  for (const p of pages) {
    if (!isStale(p.lastCheckedAt)) continue;
    // Same account-wide short-circuit as refreshStaleCompetitors: once Apify reports the
    // quota gone, every further Instagram page this tick would fail the same way, so they
    // are reported as not-attempted rather than each burning another failed call. YouTube
    // pages are unaffected — they run on the official Data API, not Apify — so they keep
    // going even after an Instagram page has tripped this.
    if (quotaExhausted && p.platform === "instagram") {
      results.push({ handle: p.igHandle, ok: false, error: "Apify quota exhausted — not attempted" });
      continue;
    }
    try {
      await scrapeFanPageFull(p.platform, p.igHandle);
      results.push({ handle: p.igHandle, ok: true });
    } catch (err) {
      if (isApifyQuotaFailure(err)) quotaExhausted = true;
      results.push({ handle: p.igHandle, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

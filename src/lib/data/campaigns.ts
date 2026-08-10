import { prisma } from "@/lib/prisma";
import type { Campaign } from "@prisma/client";
import { computeBuzzScore, type BuzzScoreResult } from "@/lib/scoring/buzzScore";
import { getCampaignEvents, type CampaignEventRow } from "@/lib/data/campaignEvents";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

const ICON_PALETTE = [
  { bg: "#fde8ef", icon: "🎬" },
  { bg: "#e8f5e9", icon: "📣" },
  { bg: "#e3f2fd", icon: "🎯" },
  { bg: "#f3e5f5", icon: "✨" },
  { bg: "#fff8e1", icon: "🔥" },
];

function iconFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[hash % ICON_PALETTE.length];
}

async function campaignStats(campaignId: string) {
  const [postCount, engAgg] = await Promise.all([
    prisma.post.count({ where: { campaignId } }),
    prisma.post.aggregate({ where: { campaignId }, _sum: { likes: true, comments: true } }),
  ]);
  // True reach is a private Insights metric — never available for scraped public
  // posts (see Phase 1 §5). Engagement (likes+comments) is the honest substitute.
  const engagement = (engAgg._sum.likes ?? 0) + (engAgg._sum.comments ?? 0);
  return { postCount, engagement };
}

export async function getOwnCampaigns() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { startDate: "desc" } });
  const withStats = await Promise.all(
    campaigns.map(async (c) => {
      const { postCount, engagement } = await campaignStats(c.id);
      const palette = iconFor(c.id);
      const dateRange =
        c.startDate && c.endDate
          ? `${c.startDate.toLocaleDateString()} – ${c.endDate.toLocaleDateString()}`
          : c.startDate
            ? `Started ${c.startDate.toLocaleDateString()}`
            : "No dates set";
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        iconBg: palette.bg,
        icon: palette.icon,
        meta: `${dateRange} · ${c.hashtags.map((h) => `#${h}`).join(" ")}`,
        postCount,
        engagement,
        stats:
          postCount > 0
            ? [
                { label: "posts", value: String(postCount) },
                { label: "engagement", value: fmtCompact(engagement) },
              ]
            : [],
      };
    }),
  );

  const active = campaigns.filter((c) => c.status === "live").length;
  const totalEngagement = withStats.reduce((sum, c) => sum + c.engagement, 0);
  const hashtagsTracked = await prisma.hashtagSnapshot.groupBy({ by: ["hashtag"] }).then((rows) => rows.length);

  return {
    campaigns: withStats,
    kpis: { active, totalHashtagReach: fmtCompact(totalEngagement), hashtagsTracked },
  };
}

export async function createCampaign(input: {
  name: string;
  status: "live" | "planned";
  hashtags: string[];
  startDate?: string;
  endDate?: string;
  type?: string;
}): Promise<Campaign> {
  return prisma.campaign.create({
    data: {
      name: input.name,
      status: input.status,
      // Lowercased to match the tag normalization scrapeByHashtag/trackHashtag always
      // apply — otherwise a campaign created with "#Vijayam" would never link up with
      // posts scraped (and stored lowercase) for "vijayam".
      hashtags: input.hashtags.map((h) => h.replace(/^#/, "").trim().toLowerCase()).filter(Boolean),
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      type: input.type || null,
    },
  });
}

const STREAM_PALETTE = [
  { bg: "#fde8ef", c: "#E1306C" },
  { bg: "#e8f5e9", c: "#1a7a4a" },
  { bg: "#e3f2fd", c: "#1565c0" },
  { bg: "#f3e5f5", c: "#6a1b9a" },
];

export interface StreamItem {
  id: string;
  av: string;
  bg: string;
  c: string;
  handle: string;
  time: string;
  text: string;
  likes: string;
  comments: string;
  tag: "Fan page" | "Public";
  externalUrl: string | null;
}

function toStreamItem(
  p: {
    id: string;
    authorHandle: string | null;
    postedAt: Date | null;
    scrapedAt: Date;
    caption: string | null;
    likes: number | null;
    comments: number | null;
    externalUrl?: string | null;
  },
  isFanPage: boolean,
  i: number,
): StreamItem {
  const handle = (p.authorHandle ?? "").replace(/^@/, "");
  const palette = STREAM_PALETTE[i % STREAM_PALETTE.length];
  return {
    id: p.id,
    av: handle.slice(0, 2).toUpperCase() || "??",
    bg: palette.bg,
    c: palette.c,
    handle: handle ? `@${handle}` : "@unknown",
    time: (p.postedAt ?? p.scrapedAt).toLocaleString(),
    text: p.caption ?? "",
    likes: String(p.likes ?? 0),
    comments: String(p.comments ?? 0),
    tag: isFanPage ? "Fan page" : "Public",
    externalUrl: p.externalUrl ?? null,
  };
}

// Recent-30 stream for a single campaign, independent of getCampaignDetail's full-history
// query — this is the poll target for LiveStream.tsx (see requireSession()-gated
// getCampaignStreamAction), so it stays a light, single-purpose query rather than
// recomputing hourly volume/sentiment/etc. on every ~8s poll tick.
export async function getCampaignStream(campaignId: string): Promise<StreamItem[]> {
  const posts = await prisma.post.findMany({
    where: { campaignId },
    orderBy: { postedAt: "desc" },
    take: 30,
    // Explicit select — was fetching every column including `raw` (the full Apify scrape
    // blob, ~4KB/post average), never used by toStreamItem below. Pure waste on a poll
    // target hit every ~8s by LiveStream.tsx.
    select: { id: true, authorHandle: true, postedAt: true, scrapedAt: true, caption: true, likes: true, comments: true, externalUrl: true },
  });
  const fanPageHandles = new Set(
    (await prisma.fanPage.findMany({ where: { isActive: true }, select: { igHandle: true } })).map((f) =>
      f.igHandle.replace(/^@/, "").toLowerCase(),
    ),
  );
  return posts.map((p, i) => toStreamItem(p, fanPageHandles.has((p.authorHandle ?? "").replace(/^@/, "").toLowerCase()), i));
}

// null when zero posts are classified yet — render the full "Pending" placeholder in that
// case. Otherwise these percentages are computed over classifiedCount posts, not totalCount —
// classifiedCount/totalCount are shown alongside so a partial campaign never looks complete.
export interface CampaignSentiment {
  classifiedCount: number;
  totalCount: number;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
}

// One entry per classified post — sentiment is scored per post (caption + up to 20
// comments combined into one text block, see classifyPostsForSentiment), not per
// individual comment, so this is "posts whose overall sentiment came out negative",
// not a list of individual negative comments.
export interface CampaignSentimentItem {
  id: string;
  handle: string;
  externalUrl: string | null;
  caption: string;
  score: number;
  keywords: string[];
}

// One entry per calendar day that has at least one classified post — sparse, not padded
// to a fixed window, since campaigns vary widely in how long they've been tracked.
export interface SentimentTrendPoint {
  date: string; // YYYY-MM-DD
  positivePct: number;
  classified: number;
}

export interface CampaignHashtagRow {
  hashtag: string;
  postCount: number;
  totalEngagement: number;
  avgEngagementPerPost: number;
}

// Media-kit top-posts list (see getCampaignDetail below). No thumbnail/image field exists
// on Post — the Apify scrape never stores a display_url column, and even `raw` (which might
// carry one) gets nulled by prune-raw-payloads after COMMENT_RETENTION_DAYS, so this is a
// text/stat card that links out to the real post, not an image gallery.
export interface CampaignTopPost {
  id: string;
  handle: string;
  caption: string;
  likes: number;
  comments: number;
  engagement: number;
  externalUrl: string | null;
  postedAtLabel: string | null;
  mediaType: string | null;
}

const TOP_POSTS_LIMIT = 10;

export interface CampaignDetail {
  id: string;
  name: string;
  tag: string;
  startedLabel: string;
  buzzScore: BuzzScoreResult;
  // Raw numbers alongside the formatted hero fields below — needed for cross-campaign
  // comparison (see getCampaignCompareData), which can't do math on "146.7K"-style strings.
  postCount: number;
  engagementRaw: number;
  peakVolume: number;
  hero: { postsToday: string; lastHour: string; engagement: string; uniqueAccounts: string };
  kpis: { label: string; value: string; delta?: string; pending?: boolean }[];
  hourlyVolume: number[];
  peakLabel: string;
  sentiment: CampaignSentiment | null;
  sentimentItems: { pos: CampaignSentimentItem[]; neu: CampaignSentimentItem[]; neg: CampaignSentimentItem[] };
  sentimentTrend: SentimentTrendPoint[];
  geoSpreadPending: { reason: string };
  keywordPills: string[];
  stream: StreamItem[];
  // Per-tracked-hashtag engagement, ranked — see getCampaignHashtagBreakdown. Not a strict
  // partition of postCount: a post can carry more than one tracked tag (e.g. a fan post
  // mentioning both the movie tag and a cast member's tag), so totals across rows can exceed
  // the campaign's own post count. That's correct for "who's driving buzz," not a bug.
  hashtagBreakdown: CampaignHashtagRow[];
  // Top TOP_POSTS_LIMIT posts by engagement (likes+comments) — built for the media-kit
  // export but computed here unconditionally since it's a free sort/slice over posts this
  // function already fetched (no new query), same discipline as buzzScore/hashtagBreakdown.
  topPosts: CampaignTopPost[];
  // Hand-logged milestones (trailer drop, premiere, ...) — see campaignEvents.ts. Read by
  // the campaign detail page's timeline card and cross-referenced against sentimentTrend.
  events: CampaignEventRow[];
}

// Reuses the exact raw->hashtags containment pattern trackHashtag() already uses for global
// hashtag matching (see below), scoped to one campaign and run per-tag instead of per-tag
// globally. Deliberately a set of small raw queries (one per hashtag) rather than fetching
// `posts.raw` into JS and filtering client-side — getCampaignDetail's own posts query already
// explicitly excludes `raw` (a ~4KB/post JSON blob) for exactly this performance reason; this
// keeps the containment check inside Postgres instead of reversing that fix.
async function getCampaignHashtagBreakdown(campaignId: string, hashtags: string[]): Promise<CampaignHashtagRow[]> {
  if (hashtags.length === 0) return [];

  const rows = await Promise.all(
    hashtags.map(async (tag) => {
      const matched = await prisma.$queryRaw<{ likes: number | null; comments: number | null }[]>`
        SELECT likes, comments FROM posts
        WHERE campaign_id = ${campaignId} AND raw -> 'hashtags' @> to_jsonb(ARRAY[${tag}]::text[])
      `;
      const postCount = matched.length;
      const totalEngagement = matched.reduce((s, p) => s + (p.likes ?? 0) + (p.comments ?? 0), 0);
      return {
        hashtag: tag,
        postCount,
        totalEngagement,
        avgEngagementPerPost: postCount ? Math.round(totalEngagement / postCount) : 0,
      };
    }),
  );

  return rows.sort((a, b) => b.totalEngagement - a.totalEngagement);
}

const HOURLY_BUCKETS = 12;

export async function getCampaignDetail(id: string): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return null;

  const posts = await prisma.post.findMany({
    where: { campaignId: id },
    orderBy: { postedAt: "desc" },
    // Explicit select — was fetching every column including `raw` (the full Apify scrape
    // blob, ~4KB/post average, never read here) for every post in the campaign, unbounded.
    // For a 343-post campaign that's ~1.4MB of unused JSON parsed on every single page
    // load. None of this function's logic (aggregates, hourly buckets, stream, sentiment
    // join) ever touches `.raw` — confirmed by reading the whole function, not assumed.
    select: {
      id: true,
      authorHandle: true,
      postedAt: true,
      scrapedAt: true,
      caption: true,
      likes: true,
      comments: true,
      externalUrl: true,
      mediaType: true,
    },
  });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const postsToday = posts.filter((p) => (p.postedAt ?? p.scrapedAt) >= startOfToday).length;
  const lastHour = posts.filter((p) => (p.postedAt ?? p.scrapedAt) >= oneHourAgo).length;
  const uniqueAccounts = new Set(posts.map((p) => p.authorHandle).filter(Boolean)).size;
  const engagement = posts.reduce((sum, p) => sum + (p.likes ?? 0) + (p.comments ?? 0), 0);
  const reelCount = posts.filter((p) => p.mediaType === "reel").length;
  const avgEngagementPerPost = posts.length ? engagement / posts.length : 0;

  // Hourly buckets since campaign start (or since the earliest scraped post if no
  // start_date / tracking predates it), most recent HOURLY_BUCKETS hours.
  const trackingStart = campaign.startDate ?? posts.at(-1)?.postedAt ?? now;
  const bucketStart = new Date(
    Math.max(trackingStart.getTime(), now.getTime() - HOURLY_BUCKETS * 60 * 60 * 1000),
  );
  const hourlyVolume: number[] = Array(HOURLY_BUCKETS).fill(0);
  for (const p of posts) {
    const t = p.postedAt ?? p.scrapedAt;
    if (t < bucketStart) continue;
    const bucketIdx = Math.min(
      HOURLY_BUCKETS - 1,
      Math.floor((t.getTime() - bucketStart.getTime()) / (60 * 60 * 1000)),
    );
    hourlyVolume[bucketIdx]++;
  }
  const peakIdx = hourlyVolume.indexOf(Math.max(...hourlyVolume));
  const peakLabel = `Peak: ${hourlyVolume[peakIdx]}/hr`;

  const fanPageHandles = new Set(
    (await prisma.fanPage.findMany({ where: { isActive: true }, select: { igHandle: true } })).map((f) =>
      f.igHandle.replace(/^@/, "").toLowerCase(),
    ),
  );

  const stream = posts
    .slice(0, 30)
    .map((p, i) => toStreamItem(p, fanPageHandles.has((p.authorHandle ?? "").replace(/^@/, "").toLowerCase()), i));

  // Real sentiment/keyword data (Phase 4) — computed over whichever posts have a `sentiment`
  // row today. Never averaged against totalCount, so a partly-classified campaign shows an
  // honest "N of M classified" subset instead of a full-looking-but-partial aggregate.
  const sentiments = posts.length
    ? await prisma.sentiment.findMany({ where: { postId: { in: posts.map((p) => p.id) } } })
    : [];
  const classifiedCount = sentiments.length;
  const sentiment: CampaignSentiment | null = classifiedCount
    ? {
        classifiedCount,
        totalCount: posts.length,
        positivePct: Math.round((sentiments.filter((s) => s.label === "pos").length / classifiedCount) * 100),
        neutralPct: Math.round((sentiments.filter((s) => s.label === "neu").length / classifiedCount) * 100),
        negativePct: Math.round((sentiments.filter((s) => s.label === "neg").length / classifiedCount) * 100),
      }
    : null;

  const postsById = new Map(posts.map((p) => [p.id, p]));
  const sentimentItems: { pos: CampaignSentimentItem[]; neu: CampaignSentimentItem[]; neg: CampaignSentimentItem[] } = {
    pos: [],
    neu: [],
    neg: [],
  };
  for (const s of sentiments) {
    const post = postsById.get(s.postId);
    if (!post) continue;
    const handle = (post.authorHandle ?? "").replace(/^@/, "");
    sentimentItems[s.label].push({
      id: post.id,
      handle: handle ? `@${handle}` : "@unknown",
      externalUrl: post.externalUrl ?? null,
      caption: post.caption ?? "",
      score: s.score,
      keywords: s.keywords,
    });
  }
  // Most confident/intense first within each label — surfaces the clearest examples up top.
  sentimentItems.pos.sort((a, b) => b.score - a.score);
  sentimentItems.neu.sort((a, b) => b.score - a.score);
  sentimentItems.neg.sort((a, b) => b.score - a.score);

  // Bucketed by the post's actual postedAt date, not analyzedAt — analyzedAt reflects
  // when a backfill/cron happened to classify it (often clustered in one run), while
  // postedAt reflects the real campaign timeline this chart is meant to show.
  const dayBuckets = new Map<string, { pos: number; neu: number; neg: number }>();
  for (const s of sentiments) {
    const post = postsById.get(s.postId);
    const day = (post?.postedAt ?? post?.scrapedAt)?.toISOString().slice(0, 10);
    if (!day) continue;
    const bucket = dayBuckets.get(day) ?? { pos: 0, neu: 0, neg: 0 };
    bucket[s.label]++;
    dayBuckets.set(day, bucket);
  }
  const sentimentTrend: SentimentTrendPoint[] = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => {
      const classified = b.pos + b.neu + b.neg;
      return { date, positivePct: classified ? Math.round((b.pos / classified) * 100) : 0, classified };
    });

  const keywordFreq = new Map<string, number>();
  for (const s of sentiments) {
    for (const kw of s.keywords) {
      const key = kw.trim().toLowerCase();
      if (!key) continue;
      keywordFreq.set(key, (keywordFreq.get(key) ?? 0) + 1);
    }
  }
  const keywordPills = Array.from(keywordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term);

  const buzzScore = computeBuzzScore({
    postCount: posts.length,
    hourlyVolume,
    sentiment: sentiment ? { positivePct: sentiment.positivePct, negativePct: sentiment.negativePct } : null,
  });

  const hashtagBreakdown = await getCampaignHashtagBreakdown(id, campaign.hashtags);

  const topPosts: CampaignTopPost[] = [...posts]
    .map((p) => {
      const handle = (p.authorHandle ?? "").replace(/^@/, "");
      return {
        id: p.id,
        handle: handle ? `@${handle}` : "@unknown",
        caption: p.caption ?? "",
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        engagement: (p.likes ?? 0) + (p.comments ?? 0),
        externalUrl: p.externalUrl ?? null,
        postedAtLabel: (p.postedAt ?? p.scrapedAt)?.toLocaleDateString() ?? null,
        mediaType: p.mediaType ?? null,
      };
    })
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, TOP_POSTS_LIMIT);

  const events = await getCampaignEvents(id);

  return {
    id: campaign.id,
    name: campaign.name,
    tag: campaign.hashtags.map((h) => `#${h}`).join(" "),
    startedLabel: campaign.startDate
      ? `${campaign.type ?? "Campaign"} · Started ${campaign.startDate.toLocaleDateString()}`
      : (campaign.type ?? "Campaign"),
    buzzScore,
    postCount: posts.length,
    engagementRaw: engagement,
    peakVolume: hourlyVolume[peakIdx],
    hero: {
      postsToday: String(postsToday),
      lastHour: `+${lastHour}`,
      engagement: fmtCompact(engagement),
      uniqueAccounts: String(uniqueAccounts),
    },
    kpis: [
      { label: "Avg Engagement/Post", value: fmtCompact(avgEngagementPerPost) },
      {
        label: "Reels With Tag",
        value: String(reelCount),
        delta: posts.length ? `${Math.round((reelCount / posts.length) * 100)}% of posts` : undefined,
      },
      { label: "Stories With Tag", value: "—", pending: true },
      sentiment
        ? { label: "Sentiment", value: `${sentiment.positivePct}% pos`, delta: `${classifiedCount}/${posts.length} classified` }
        : { label: "Sentiment", value: "—", pending: true },
    ],
    hourlyVolume,
    peakLabel,
    sentiment,
    sentimentItems,
    sentimentTrend,
    geoSpreadPending: {
      reason: "No location signal in current scrape scope — public post scrapes don't carry geo data.",
    },
    keywordPills,
    stream,
    hashtagBreakdown,
    topPosts,
    events,
  };
}

export interface CampaignCompareOption {
  id: string;
  name: string;
  status: string;
}

// Own-campaign-to-campaign comparison (not to be confused with /compare, which benchmarks
// against competitor accounts). No "ended" CampaignStatus exists yet (only live/planned), so
// this compares currently-active campaigns side by side rather than genuine past-vs-present
// history — a real historical view would need that status added separately.
export async function getCampaignCompareOptions(): Promise<CampaignCompareOption[]> {
  return prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } });
}

export interface CampaignCompareColumn {
  id: string;
  name: string;
  tag: string;
  buzzScore: number;
  positivePct: number | null;
  postCount: number;
  engagement: number;
  peakVolume: number;
  topHashtag: string | null;
}

export interface CampaignCompareMetricRow {
  key: "buzzScore" | "positivePct" | "postCount" | "engagement" | "peakVolume";
  label: string;
  format: (v: number) => string;
}

export const CAMPAIGN_COMPARE_METRIC_ROWS: CampaignCompareMetricRow[] = [
  { key: "buzzScore", label: "Buzz Score", format: (v) => String(v) },
  { key: "positivePct", label: "Positive Sentiment", format: (v) => `${v}%` },
  { key: "engagement", label: "Total Engagement", format: fmtCompact },
  { key: "postCount", label: "Posts Tracked", format: (v) => String(v) },
  { key: "peakVolume", label: "Peak Volume (posts/hr)", format: (v) => String(v) },
];

function campaignMetricValue(col: CampaignCompareColumn, key: CampaignCompareMetricRow["key"]): number | null {
  switch (key) {
    case "buzzScore": return col.buzzScore;
    case "positivePct": return col.positivePct;
    case "postCount": return col.postCount;
    case "engagement": return col.engagement;
    case "peakVolume": return col.peakVolume;
  }
}

export interface CampaignCompareResult {
  columns: CampaignCompareColumn[];
  // key/label only, deliberately not the full CampaignCompareMetricRow — that type carries a
  // `format` function, which isn't serializable across the server/client boundary once this
  // crosses into a "use client" component's props (confirmed live: Next.js throws "Functions
  // cannot be passed directly to Client Components" if `...row` is spread in below).
  rows: {
    key: CampaignCompareMetricRow["key"];
    label: string;
    cells: { columnId: string; value: number | null; display: string; pct: number; isWin: boolean }[];
  }[];
}

// Reuses getCampaignDetail entirely rather than a second aggregate query — with only a
// handful of campaigns ever compared at once, re-deriving buzz score/sentiment/hashtag data
// separately would just be duplicated logic for no real performance win. Row/cell/pct/isWin
// shape mirrors getCompareData()'s exact pattern in this same file, computed here (not in the
// page component) for the same reason that one is: the page should stay a thin renderer.
export async function getCampaignCompareData(campaignIds: string[]): Promise<CampaignCompareResult> {
  const details = await Promise.all(campaignIds.map((id) => getCampaignDetail(id)));
  const columns: CampaignCompareColumn[] = details
    .filter((d): d is CampaignDetail => d !== null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      tag: d.tag,
      buzzScore: d.buzzScore.score,
      positivePct: d.sentiment?.positivePct ?? null,
      postCount: d.postCount,
      engagement: d.engagementRaw,
      peakVolume: d.peakVolume,
      topHashtag: d.hashtagBreakdown[0]?.hashtag ?? null,
    }));

  const rows = CAMPAIGN_COMPARE_METRIC_ROWS.map((row) => {
    const cells = columns.map((col) => {
      const value = campaignMetricValue(col, row.key);
      return { columnId: col.id, value, display: value === null ? "—" : row.format(value) };
    });
    const numericValues = cells.map((c) => c.value).filter((v): v is number => v !== null);
    const max = numericValues.length ? Math.max(...numericValues) : 0;
    const hasComparison = numericValues.length >= 2;
    // key/label only (not `...row`) — row.format is a function and must never reach a "use
    // client" component's props, see CampaignCompareResult's comment.
    return {
      key: row.key,
      label: row.label,
      cells: cells.map((c) => ({
        ...c,
        pct: max > 0 && c.value !== null ? Math.round((c.value / max) * 100) : 0,
        isWin: hasComparison && max > 0 && c.value !== null && c.value === max,
      })),
    };
  });

  return { columns, rows };
}

// Status pills for the tracked-hashtag table. Thresholds are deliberately named
// constants, not magic numbers, so they're easy to retune later.
const TRENDING_WINDOW_HOURS = 6;
const TRENDING_MULTIPLIER = 2;
const MIN_POSTS_FOR_TRENDING = 5;
const NEW_WINDOW_HOURS = 24;

export async function getTrackedHashtags() {
  const snapshots = await prisma.hashtagSnapshot.findMany({ orderBy: { snapshotAt: "asc" } });
  if (snapshots.length === 0) return [];

  const byTag = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = byTag.get(s.hashtag) ?? [];
    list.push(s);
    byTag.set(s.hashtag, list);
  }

  const campaigns = await prisma.campaign.findMany({ where: { status: "live" }, select: { hashtags: true } });
  const campaignTags = new Set(campaigns.flatMap((c) => c.hashtags.map((h) => h.toLowerCase())));

  const now = new Date();
  const rows = await Promise.all(
    Array.from(byTag.entries()).map(async ([tag, history]) => {
      const first = history[0];

      const matched = await prisma.$queryRaw<
        { id: string; likes: number | null; comments: number | null; posted_at: Date | null }[]
      >`
        SELECT id, likes, comments, posted_at
        FROM posts
        WHERE raw -> 'hashtags' @> to_jsonb(ARRAY[${tag}]::text[])
      `;
      const postCount = matched.length;
      const avgEng = postCount
        ? matched.reduce((s, m) => s + (m.likes ?? 0) + (m.comments ?? 0), 0) / postCount
        : 0;
      const recentWindow = new Date(now.getTime() - TRENDING_WINDOW_HOURS * 60 * 60 * 1000);
      const recentCount = matched.filter((m) => m.posted_at && m.posted_at >= recentWindow).length;
      const trackedHours = Math.max(1, (now.getTime() - first.snapshotAt.getTime()) / (60 * 60 * 1000));
      const avgHourlyRate = postCount / trackedHours;
      const isTrending =
        postCount >= MIN_POSTS_FOR_TRENDING &&
        recentCount / TRENDING_WINDOW_HOURS > avgHourlyRate * TRENDING_MULTIPLIER;
      const isNew = now.getTime() - first.snapshotAt.getTime() < NEW_WINDOW_HOURS * 60 * 60 * 1000;
      const isCampaignTag = campaignTags.has(tag.toLowerCase());

      const status = isCampaignTag ? "Campaign" : isTrending ? "Trending" : isNew ? "New" : "Active";

      return { tag, postCount, avgEng, status };
    }),
  );

  const maxPosts = Math.max(1, ...rows.map((r) => r.postCount));
  return rows.map((r) => ({
    name: `#${r.tag}`,
    fillPct: Math.round((r.postCount / maxPosts) * 100),
    posts: `${r.postCount} posts`,
    eng: `${r.avgEng.toFixed(1)}`,
    tag: r.status,
  }));
}

// Returns the db ids of every post currently tagged with this hashtag, so callers can queue
// them for sentiment classification (see trackHashtagAction and poll-hashtags) without a
// second, parallel post-lookup mechanism.
export async function trackHashtag(tagInput: string): Promise<string[]> {
  const { getPublicContentProvider } = await import("@/lib/providers");
  const tag = tagInput.replace(/^#/, "").trim().toLowerCase();
  if (!tag) throw new Error("hashtag is required");

  await getPublicContentProvider().scrapeByHashtag(tag);

  const matched = await prisma.$queryRaw<{ id: string; likes: number | null; comments: number | null }[]>`
    SELECT id, likes, comments FROM posts WHERE raw -> 'hashtags' @> to_jsonb(ARRAY[${tag}]::text[])
  `;
  const postCount = matched.length;
  const avgEngRate = postCount
    ? matched.reduce((s, m) => s + (m.likes ?? 0) + (m.comments ?? 0), 0) / postCount
    : 0;

  await prisma.hashtagSnapshot.create({
    data: { hashtag: tag, postCount, avgEngRate },
  });

  const postIds = matched.map((m) => m.id);
  // Cheap (DB reads/writes only, no external calls) — a direct awaited call is fine
  // here, unlike the sentiment pipeline's after()-deferred queueSentimentClassification.
  const { checkFanPageVelocityAlerts } = await import("@/lib/data/fanPageAlerts");
  await checkFanPageVelocityAlerts(postIds);

  return postIds;
}

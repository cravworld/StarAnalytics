import { prisma } from "@/lib/prisma";
import type { Campaign } from "@prisma/client";

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
      hashtags: input.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
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
  };
}

export interface CampaignDetail {
  id: string;
  tag: string;
  startedLabel: string;
  hero: { postsToday: string; lastHour: string; engagement: string; uniqueAccounts: string };
  kpis: { label: string; value: string; delta?: string; pending?: boolean }[];
  hourlyVolume: number[];
  peakLabel: string;
  sentimentPending: true;
  geoSpreadPending: { reason: string };
  keywordsPending: true;
  stream: StreamItem[];
}

const HOURLY_BUCKETS = 12;

export async function getCampaignDetail(id: string): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return null;

  const posts = await prisma.post.findMany({
    where: { campaignId: id },
    orderBy: { postedAt: "desc" },
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

  return {
    id: campaign.id,
    tag: campaign.hashtags.map((h) => `#${h}`).join(" "),
    startedLabel: campaign.startDate
      ? `${campaign.type ?? "Campaign"} · Started ${campaign.startDate.toLocaleDateString()}`
      : (campaign.type ?? "Campaign"),
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
      { label: "Sentiment", value: "—", pending: true },
    ],
    hourlyVolume,
    peakLabel,
    sentimentPending: true,
    geoSpreadPending: {
      reason: "No location signal in current scrape scope — public post scrapes don't carry geo data.",
    },
    keywordsPending: true,
    stream,
  };
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

export async function trackHashtag(tagInput: string) {
  const { getPublicContentProvider } = await import("@/lib/providers");
  const tag = tagInput.replace(/^#/, "").trim().toLowerCase();
  if (!tag) throw new Error("hashtag is required");

  await getPublicContentProvider().scrapeByHashtag(tag);

  const matched = await prisma.$queryRaw<{ likes: number | null; comments: number | null }[]>`
    SELECT likes, comments FROM posts WHERE raw -> 'hashtags' @> to_jsonb(ARRAY[${tag}]::text[])
  `;
  const postCount = matched.length;
  const avgEngRate = postCount
    ? matched.reduce((s, m) => s + (m.likes ?? 0) + (m.comments ?? 0), 0) / postCount
    : 0;

  await prisma.hashtagSnapshot.create({
    data: { hashtag: tag, postCount, avgEngRate },
  });
}

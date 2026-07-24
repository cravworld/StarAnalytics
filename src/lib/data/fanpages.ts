import { prisma } from "@/lib/prisma";
import { fetchProfileSnapshot, backfillFanPageLink } from "@/lib/providers/apify-public-content";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

// Same hash-based deterministic assignment pattern as campaigns.ts's ICON_PALETTE —
// stable across renders/requests without persisting a colour choice anywhere.
const AVATAR_PALETTE = [
  { bg: "#fde8ef", c: "#E1306C" },
  { bg: "#e8f5e9", c: "#1a7a4a" },
  { bg: "#f3e5f5", c: "#6a1b9a" },
  { bg: "#e3f2fd", c: "#1565c0" },
  { bg: "#fff8e1", c: "#e65100" },
];

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

async function fanPageRow(page: {
  id: string;
  igHandle: string;
  displayName: string | null;
  followers: number | null;
  isVerifiedFan: boolean;
}) {
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

  const fanPages = await Promise.all(activePages.map(fanPageRow));

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

// Manual add, or promoting a suggestion — same code path either way. Spends the one
// Apify profile-only call this action costs, then backfills fanPageId onto any posts
// already scraped under this handle so the tracked list shows real data immediately
// rather than waiting for the next poll cycle.
export async function addFanPage(handleInput: string): Promise<void> {
  const handle = handleInput.replace(/^@/, "").trim();
  if (!handle) throw new Error("handle is required");

  const existing = await prisma.fanPage.findUnique({ where: { platform_igHandle: { platform: "instagram", igHandle: handle } } });
  if (existing) {
    if (!existing.isActive) {
      await prisma.fanPage.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return;
  }

  const snapshot = await fetchProfileSnapshot(handle);
  const fanPage = await prisma.fanPage.create({
    data: { igHandle: handle, displayName: snapshot.displayName, followers: snapshot.followers, lastCheckedAt: new Date() },
  });
  await backfillFanPageLink(handle, fanPage.id);
}

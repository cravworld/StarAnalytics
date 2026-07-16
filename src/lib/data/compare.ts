import { prisma } from "@/lib/prisma";
import { getInstagramInsightsProvider, getPublicContentProvider } from "@/lib/providers";
import type { RawPost } from "@/lib/providers/types";

// Comparison numbers aren't real-time — a follower count or engagement estimate a few
// hours stale doesn't change a strategic read. Named constant, not a magic number
// buried in a conditional (same convention as campaigns.ts's VELOCITY_WINDOW_MINUTES /
// getTrackedHashtags's threshold style). This is the fix for the long-standing leak:
// since Phase 1, /compare called scrapeByHandle() on every single render — two full
// Apify actor runs (profile + posts) per page load. The render path below only ever
// reads competitor_accounts/posts; a scrape only happens from addCompetitor() (an
// explicit action) or refreshStaleCompetitors() (the polling cron), never from render.
const COMPETITOR_SCRAPE_TTL_HOURS = 12;

// Recent-post sample for avg-likes/engagement-rate, matching fanpages.ts's
// RECENT_POSTS_FOR_ENG_SAMPLE convention (a coverage sample, not the full history).
const RECENT_POSTS_FOR_METRICS = 20;

function isStale(lastScrapedAt: Date | null): boolean {
  if (!lastScrapedAt) return true;
  return Date.now() - lastScrapedAt.getTime() > COMPETITOR_SCRAPE_TTL_HOURS * 60 * 60 * 1000;
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

async function storeCompetitorPosts(competitorId: string, posts: RawPost[]): Promise<void> {
  for (const p of posts) {
    if (!p.igShortcode) continue;
    await prisma.post.upsert({
      where: { igShortcode: p.igShortcode },
      create: {
        source: "competitor",
        igShortcode: p.igShortcode,
        externalUrl: p.externalUrl,
        authorHandle: p.authorHandle,
        mediaType: p.mediaType,
        caption: p.caption,
        postedAt: new Date(p.postedAt),
        likes: p.likes,
        comments: p.comments,
        raw: p.raw as object,
        competitorId,
      },
      update: {
        externalUrl: p.externalUrl,
        mediaType: p.mediaType,
        caption: p.caption,
        postedAt: new Date(p.postedAt),
        likes: p.likes,
        comments: p.comments,
        raw: p.raw as object,
        competitorId,
        scrapedAt: new Date(),
      },
    });
  }
}

// The only place a real Apify call for a competitor happens. Called from addCompetitor
// (first add) and refreshStaleCompetitors (cron, TTL-gated) — never from a page render.
async function scrapeCompetitor(handle: string): Promise<void> {
  const snapshot = await getPublicContentProvider().scrapeByHandle(handle);
  const competitor = await prisma.competitorAccount.upsert({
    where: { igHandle: snapshot.handle },
    create: { igHandle: snapshot.handle, displayName: snapshot.displayName, followers: snapshot.followers, lastScrapedAt: new Date() },
    update: { displayName: snapshot.displayName, followers: snapshot.followers, lastScrapedAt: new Date() },
  });
  await storeCompetitorPosts(competitor.id, snapshot.posts);
}

export async function addCompetitor(handleInput: string): Promise<void> {
  const handle = handleInput.replace(/^@/, "").trim();
  if (!handle) throw new Error("handle is required");
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(handle)) throw new Error("not a valid Instagram handle");

  const existing = await prisma.competitorAccount.findUnique({ where: { igHandle: handle } });
  if (existing) return;

  // A brand-new row has no lastScrapedAt, so this is the one case that always scrapes —
  // it falls out of the same "does this row need a fresh scrape" question refreshStaleCompetitors
  // asks, not a special first-add exception.
  await scrapeCompetitor(handle);
}

export async function removeCompetitor(id: string): Promise<void> {
  await prisma.competitorAccount.delete({ where: { id } });
  // Their historical posts stay (source: "competitor", competitorId now dangling to a
  // deleted row) — this screen only ever queries via current competitor_accounts rows,
  // so they simply stop appearing rather than needing an explicit cleanup pass.
}

// Called only from the polling cron (see poll-hashtags route) — refreshes any tracked
// competitor whose data is past the TTL. One competitor's scrape failing (rate limit,
// actor error) shouldn't block the others, same discipline as the hashtag poll loop.
export async function refreshStaleCompetitors(): Promise<{ handle: string; ok: boolean; error?: string }[]> {
  const all = await prisma.competitorAccount.findMany();
  const results: { handle: string; ok: boolean; error?: string }[] = [];
  for (const c of all) {
    if (!isStale(c.lastScrapedAt)) continue;
    try {
      await scrapeCompetitor(c.igHandle);
      results.push({ handle: c.igHandle, ok: true });
    } catch (err) {
      results.push({ handle: c.igHandle, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / (60 * 1000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface CompareColumn {
  id: string;
  handle: string;
  displayName: string;
  followers: number;
  followersDisplay: string;
  avgLikesPerPost: number;
  postsPerWeek: number;
  // null = not evaluated (no data path), not zero.
  reelAvgViews: number | null;
  engagementRateEstimate: number;
  isEngagementEstimate: boolean;
  storyResponseRate: number | null;
  lastUpdatedLabel: string | null;
}

async function competitorColumn(c: { id: string; igHandle: string; displayName: string | null; followers: number | null; lastScrapedAt: Date | null }): Promise<CompareColumn> {
  const recentPosts = await prisma.post.findMany({
    where: { competitorId: c.id },
    orderBy: { postedAt: "desc" },
    take: RECENT_POSTS_FOR_METRICS,
    select: { likes: true, postedAt: true },
  });

  const likesList = recentPosts.map((p) => p.likes ?? 0);
  const avgLikesPerPost = likesList.length ? likesList.reduce((a, b) => a + b, 0) / likesList.length : 0;

  const postedDates = recentPosts.map((p) => p.postedAt).filter((d): d is Date => d !== null);
  let postsPerWeek = 0;
  if (postedDates.length >= 2) {
    const newest = Math.max(...postedDates.map((d) => d.getTime()));
    const oldest = Math.min(...postedDates.map((d) => d.getTime()));
    const spanWeeks = (newest - oldest) / (7 * 24 * 60 * 60 * 1000);
    postsPerWeek = spanWeeks > 0 ? postedDates.length / spanWeeks : postedDates.length;
  } else if (postedDates.length === 1) {
    postsPerWeek = 1;
  }

  const followers = c.followers ?? 0;
  const engagementRateEstimate = followers > 0 && avgLikesPerPost > 0 ? (avgLikesPerPost / followers) * 100 : 0;

  return {
    id: c.id,
    handle: `@${c.igHandle}`,
    displayName: c.displayName ?? c.igHandle,
    followers,
    followersDisplay: fmtCompact(followers),
    avgLikesPerPost: Math.round(avgLikesPerPost),
    postsPerWeek: Math.round(postsPerWeek * 10) / 10,
    // Apify's post-scraper only exposes video view counts under a paid "detailed data"
    // tier this integration doesn't request (see apify-normalize.ts) — reach/views are
    // never collected for any scraped post (Phase 1 rule), competitors included. Marking
    // this "not evaluated" rather than fabricating a number to match the DPR's table,
    // same discipline as Phase 3's FLAG_REGISTRY and Phase 4's partial-sentiment states.
    reelAvgViews: null,
    engagementRateEstimate: Math.round(engagementRateEstimate * 100) / 100,
    isEngagementEstimate: true,
    // Story Response Rate is a Graph-API-only insight — never available for another
    // account, ever, no matter how fresh the scrape is.
    storyResponseRate: null,
    lastUpdatedLabel: c.lastScrapedAt ? relativeTime(c.lastScrapedAt) : null,
  };
}

// AccountInsights.engagementBreakdown is a percentage split of engagement types (likes
// vs comments vs saves vs shares), not a raw like count — there's no real avg-likes
// field on that interface yet. Self stays mock this phase regardless (Phase 7), so this
// is just a placeholder mock value, not a derived one; matches the original prototype.
const SELF_AVG_LIKES_PER_POST_MOCK = 621_000;

async function selfColumn(): Promise<CompareColumn> {
  // Nivin's own side deliberately stays on whatever InstagramInsightsProvider already
  // returns (mock, same as the dashboard/content screens) — wiring it to the real Graph
  // API is Phase 7, gated on Meta App Review. Keeping the seam here rather than
  // hardcoding fresh numbers in this file means Phase 7 only has to flip
  // DATA_MODE_INSTAGRAM, not touch this screen.
  const insights = await getInstagramInsightsProvider().getAccountInsights();
  const avgLikesPerPost = SELF_AVG_LIKES_PER_POST_MOCK;
  return {
    id: "self",
    handle: "@nivinpauly",
    displayName: "Nivin Pauly",
    followers: insights.followers,
    followersDisplay: fmtCompact(insights.followers),
    avgLikesPerPost: Math.round(avgLikesPerPost),
    postsPerWeek: Math.round((insights.postsThisMonth / 4.33) * 10) / 10,
    reelAvgViews: insights.avgReelViews,
    engagementRateEstimate: insights.engagementRate,
    isEngagementEstimate: false,
    storyResponseRate: 1.8,
    lastUpdatedLabel: null,
  };
}

export interface CompareMetricRow {
  key: "followers" | "avgLikes" | "postsPerWeek" | "reelViews" | "engagementRate" | "storyResponse";
  label: string;
  format: (v: number) => string;
  higherIsBetter: boolean;
}

export const COMPARE_METRIC_ROWS: CompareMetricRow[] = [
  { key: "followers", label: "Followers", format: fmtCompact, higherIsBetter: true },
  { key: "engagementRate", label: "Engagement Rate", format: (v) => `${v.toFixed(1)}%`, higherIsBetter: true },
  { key: "avgLikes", label: "Avg Likes/Post", format: fmtCompact, higherIsBetter: true },
  { key: "postsPerWeek", label: "Posts/Week", format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "reelViews", label: "Reel Avg Views", format: fmtCompact, higherIsBetter: true },
  { key: "storyResponse", label: "Story Response Rate", format: (v) => `${v.toFixed(1)}%`, higherIsBetter: true },
];

function metricValue(col: CompareColumn, key: CompareMetricRow["key"]): number | null {
  switch (key) {
    case "followers": return col.followers;
    case "avgLikes": return col.avgLikesPerPost;
    case "postsPerWeek": return col.postsPerWeek;
    case "reelViews": return col.reelAvgViews;
    case "engagementRate": return col.engagementRateEstimate;
    case "storyResponse": return col.storyResponseRate;
  }
}

export async function getCompareData() {
  const self = await selfColumn();
  const competitorRows = await prisma.competitorAccount.findMany({ orderBy: { igHandle: "asc" } });
  const competitors = await Promise.all(competitorRows.map(competitorColumn));
  const columns = [self, ...competitors];

  const rows = COMPARE_METRIC_ROWS.map((row) => {
    const cells = columns.map((col) => {
      const value = metricValue(col, row.key);
      return {
        columnId: col.id,
        value,
        display: value === null ? "—" : row.format(value),
        isEstimate: row.key === "engagementRate" && col.isEngagementEstimate,
        private: value === null,
      };
    });
    const numericValues = cells.map((c) => c.value).filter((v): v is number => v !== null);
    const max = numericValues.length ? Math.max(...numericValues) : 0;
    // A "win" only means something when there's an actual comparison — one lone real
    // number (e.g. Story Response Rate, where every competitor is "—") isn't "beating"
    // anyone, so don't highlight it as if it were.
    const hasComparison = numericValues.length >= 2;
    return {
      ...row,
      cells: cells.map((c) => ({
        ...c,
        pct: max > 0 && c.value !== null ? Math.round((c.value / max) * 100) : 0,
        isWin: hasComparison && max > 0 && c.value !== null && c.value === max,
      })),
    };
  });

  return { self, competitors, columns, rows };
}

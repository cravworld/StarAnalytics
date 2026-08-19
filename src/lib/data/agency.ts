import type { Agency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { getPublicContentProvider, type RawPost } from "@/lib/providers";
import { computeCohortStats } from "@/lib/scoring/cohort";
import { getActiveThresholdConfig } from "@/lib/scoring/config";
import { scorePost } from "@/lib/scoring/scorePost";
import { FLAG_REGISTRY, type Flag, type PostForScoring } from "@/lib/scoring/types";
import type { AgencyUrlRow } from "@/lib/upload/parseAgencySheet";
import { IDENTITY_INKS } from "@/lib/palette";

// Identity colours live in one place now — see lib/palette.ts for why.
const AGENCY_COLOR_PALETTE = IDENTITY_INKS;

// Apify's Instagram Post Scraper documents no hard cap on the `username`
// array (confirmed against its input-schema page), but a few hundred URLs per
// run is the sane operational ceiling AGENTS.md asks for — keeps each Apify
// run (and the waitForRun poll it's wrapped in) within a reasonable time box.
const AGENCY_SCRAPE_BATCH_SIZE = 200;

export async function resolveOrCreateAgency(name: string): Promise<Agency> {
  const trimmed = name.trim();
  const existing = await prisma.agency.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
  if (existing) return existing;
  const count = await prisma.agency.count();
  return prisma.agency.create({
    data: { name: trimmed, colourHex: AGENCY_COLOR_PALETTE[count % AGENCY_COLOR_PALETTE.length] },
  });
}

function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

// Upserts by ig_shortcode, same as storePosts in apify-public-content.ts, with
// agencyId resolved and set directly at insert time. Written here rather than
// relying on the provider's own internal persistence: the live provider does
// persist as a side effect of scrapeByUrls, but MockPublicContentProvider
// deliberately never touches Prisma (Phase 0's mock-without-a-DB contract),
// so relying on that side effect would leave agency scoring unrunnable in
// mock mode. Upserting again here is idempotent and harmless when the live
// provider already wrote the same row.
async function storeAgencyPosts(posts: RawPost[], shortcodeToAgencyId: Map<string, string>): Promise<void> {
  for (const p of posts) {
    if (!p.igShortcode) continue;
    const agencyId = shortcodeToAgencyId.get(p.igShortcode) ?? null;
    const data = {
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
      agencyId,
    };
    await prisma.post.upsert({
      where: { platform_igShortcode: { platform: p.platform, igShortcode: p.igShortcode } },
      create: { source: "agency", platform: p.platform, igShortcode: p.igShortcode, ...data },
      update: { ...data, scrapedAt: new Date() },
    });
  }
}

export async function getAgencyUploadData() {
  const agencies = await prisma.agency.findMany({ orderBy: { name: "asc" } });
  return { agencies };
}

// Runs after analyseAgencyPostsAction's response is sent (via next/server's
// after()) — this is the part that can't fit inside a normal request/response
// cycle for a few hundred URLs. Every exit path (success or failure) updates
// the scrape_runs row, so /api/agency-run/[id]/status always has something
// truthful to report rather than a run stuck at "running" forever.
export async function runAgencyBatchJob(runId: string, rows: AgencyUrlRow[]): Promise<void> {
  await prisma.scrapeRun.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });

  try {
    // Resolve/create every distinct agency up front, and map each row's URL
    // shortcode to its agency so storeAgencyPosts can set agencyId directly
    // at insert time — same upsert-by-shortcode pipe Phase 1/2 already built
    // (storePosts in apify-public-content.ts), no second ingestion path.
    const agencyByName = new Map<string, Agency>();
    const shortcodeToAgencyId = new Map<string, string>();
    for (const row of rows) {
      const key = row.agencyName.trim().toLowerCase();
      let agency = agencyByName.get(key);
      if (!agency) {
        agency = await resolveOrCreateAgency(row.agencyName);
        agencyByName.set(key, agency);
      }
      const shortcode = extractShortcode(row.url);
      if (shortcode) shortcodeToAgencyId.set(shortcode, agency.id);
    }

    const provider = getPublicContentProvider();
    // De-duplicated by shortcode, not by raw URL string: the same post can legitimately
    // appear twice in an uploaded sheet (listed under two agencies, or just a copy-paste),
    // and it can appear twice in two different URL shapes (/p/ vs /reel/, trailing slash,
    // an ?igsh= tracking param). Every duplicate that reaches the actor is a dataset item
    // we pay for twice and then upsert onto the same row.
    const seenShortcodes = new Set<string>();
    const urls: string[] = [];
    for (const row of rows) {
      const shortcode = extractShortcode(row.url);
      const key = shortcode ?? row.url.trim().toLowerCase();
      if (seenShortcodes.has(key)) continue;
      seenShortcodes.add(key);
      urls.push(row.url);
    }
    if (urls.length < rows.length) {
      console.log(`agency batch ${runId}: ${rows.length - urls.length} duplicate URL(s) dropped before scraping`);
    }

    for (const batch of chunk(urls, AGENCY_SCRAPE_BATCH_SIZE)) {
      // The spend cap is account-wide: once one batch is rejected on quota, the remaining
      // batches cannot succeed either. Rethrown rather than swallowed so the run is recorded
      // as an error the operator can see, instead of silently scoring a partial batch as if
      // it were complete.
      const posts = await provider.scrapeByUrls(batch);
      await storeAgencyPosts(posts, shortcodeToAgencyId);
    }

    const scoredPosts = await prisma.post.findMany({
      where: { igShortcode: { in: Array.from(shortcodeToAgencyId.keys()) } },
    });

    // Queue comment-scrape + sentiment classification for every post this batch touched —
    // already running inside this job's own after() callback (see analyseAgencyPostsAction),
    // so a plain inline call is simplest rather than nesting another after(). Uses the
    // fire-and-forget wrapper so a sentiment failure can't fail the agency run itself —
    // scoring is the job this run is tracked for. This IS awaited (unlike poll-hashtags'
    // fire-and-forget after() call), so by the time scoring below runs, comments for this
    // batch are already scraped and stored — which is what makes generic_comment_pattern
    // detection possible here without a separate re-scoring pass.
    await queueSentimentClassification(scoredPosts.map((p) => p.id));

    const commentRows = await prisma.postComment.findMany({
      where: { postId: { in: scoredPosts.map((p) => p.id) } },
      select: { postId: true, text: true, authorHandle: true },
    });
    const commentsByPost = new Map<string, { text: string | null; authorHandle: string | null }[]>();
    for (const c of commentRows) {
      const list = commentsByPost.get(c.postId) ?? [];
      list.push({ text: c.text, authorHandle: c.authorHandle });
      commentsByPost.set(c.postId, list);
    }
    // normalized comment text -> number of DISTINCT posts (in this run) it appears on — the
    // same normalization detectGenericCommentPattern uses, duplicated here rather than
    // imported so scorePost.ts stays free of any caller-specific plumbing. Real people don't
    // independently post the same 12+ character comment on two unrelated posts; a bot/paid-
    // comment operation reusing scripted text does.
    const crossPostDuplicateCounts = new Map<string, number>();
    const seenPerText = new Map<string, Set<string>>();
    for (const c of commentRows) {
      if (!c.text) continue;
      const norm = c.text.trim().toLowerCase().replace(/\s+/g, " ");
      if (norm.length < 12) continue;
      const posts = seenPerText.get(norm) ?? new Set<string>();
      posts.add(c.postId);
      seenPerText.set(norm, posts);
      crossPostDuplicateCounts.set(norm, posts.size);
    }

    const forScoring: PostForScoring[] = scoredPosts.map((p) => ({
      id: p.id,
      likes: p.likes,
      comments: p.comments,
      postedAt: p.postedAt ? p.postedAt.toISOString() : null,
      commentTexts: commentsByPost.get(p.id) ?? [],
    }));
    const cohort = computeCohortStats(forScoring);
    const { version, params } = await getActiveThresholdConfig();

    const scoreRows = scoredPosts
      .filter((p) => p.agencyId) // a post whose URL didn't yield a shortcode never got linked — skip rather than score with a null agency
      .map((p) => {
        const result = scorePost(
          {
            id: p.id,
            likes: p.likes,
            comments: p.comments,
            postedAt: p.postedAt ? p.postedAt.toISOString() : null,
            commentTexts: commentsByPost.get(p.id) ?? [],
          },
          cohort,
          params,
          crossPostDuplicateCounts,
        );
        return {
          runId,
          agencyId: p.agencyId as string,
          postId: p.id,
          perfScore: result.perfScore,
          authScore: result.authScore,
          effScore: result.effScore,
          totalScore: result.totalScore,
          flags: result.flags as unknown as object,
          thresholdConfigVersion: version,
        };
      });

    await prisma.agencyPostScore.createMany({ data: scoreRows });
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: { status: "done", finishedAt: new Date(), itemCount: scoreRows.length },
    });
  } catch (err) {
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: { status: "error", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
    });
  }
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export interface AgencyResultRow {
  id: string;
  name: string;
  color: string;
  score: number;
  perf: number;
  auth: number;
  // null: efficiency not evaluated this phase — see EFFICIENCY_NOT_EVALUATED_REASON.
  eff: number | null;
  postCount: number;
  flaggedPostCount: number;
  // Reach is a private Insights metric, never available for scraped
  // third-party posts (established Phase 1) — engagement (likes+comments) is
  // the honest substitute, same convention as src/lib/data/campaigns.ts.
  engagementTotal: string;
}

export interface AgencyPostRow {
  id: string;
  url: string;
  agencyId: string;
  agencyName: string;
  agencyColor: string;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  saves: number | null;
  authScore: number;
  totalScore: number;
  flags: Flag[];
}

export interface AgencyRunResults {
  runId: string;
  agencies: AgencyResultRow[];
  posts: AgencyPostRow[];
  flagRegistry: typeof FLAG_REGISTRY;
  summary: {
    postsAnalysed: number;
    totalEngagement: string;
    avgEngagementPerPost: string;
    avgAuthenticity: number;
    avgPerformance: number;
    // null: not evaluated this phase, not averaged in — see EFFICIENCY_NOT_EVALUATED_REASON.
    avgEfficiency: null;
    flaggedAgencies: number;
    topAgency: { name: string; score: number } | null;
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getAgencyResults(runId: string): Promise<AgencyRunResults> {
  const scores = await prisma.agencyPostScore.findMany({
    where: { runId },
    include: { agency: true, post: true },
    orderBy: { totalScore: "desc" },
  });

  const byAgency = new Map<string, { agency: Agency; rows: typeof scores }>();
  for (const s of scores) {
    const entry = byAgency.get(s.agencyId) ?? { agency: s.agency, rows: [] };
    entry.rows.push(s);
    byAgency.set(s.agencyId, entry);
  }

  const agencies: AgencyResultRow[] = Array.from(byAgency.values())
    .map(({ agency, rows }) => {
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const flaggedPostCount = rows.filter((r) => (r.flags as unknown as Flag[]).length > 0).length;
      const engagementTotal = rows.reduce((sum, r) => sum + (r.post.likes ?? 0) + (r.post.comments ?? 0), 0);
      return {
        id: agency.id,
        name: agency.name,
        color: agency.colourHex,
        score: round(mean(rows.map((r) => r.totalScore))),
        perf: round(mean(rows.map((r) => r.perfScore))),
        auth: round(mean(rows.map((r) => r.authScore))),
        eff: null, // not evaluated this phase for any post — see EFFICIENCY_NOT_EVALUATED_REASON
        postCount: rows.length,
        flaggedPostCount,
        engagementTotal: fmtCompact(engagementTotal),
      };
    })
    .sort((a, b) => b.score - a.score);

  const posts: AgencyPostRow[] = scores.map((s) => ({
    id: s.post.id,
    url: s.post.externalUrl ?? "",
    agencyId: s.agencyId,
    agencyName: s.agency.name,
    agencyColor: s.agency.colourHex,
    likes: s.post.likes,
    comments: s.post.comments,
    reach: s.post.reach,
    saves: s.post.saves,
    authScore: round(s.authScore),
    totalScore: round(s.totalScore),
    flags: s.flags as unknown as Flag[],
  }));

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const flaggedAgencies = agencies.filter((a) => a.flaggedPostCount > 0).length;
  const totalEngagement = scores.reduce((sum, s) => sum + (s.post.likes ?? 0) + (s.post.comments ?? 0), 0);

  return {
    runId,
    agencies,
    posts,
    flagRegistry: FLAG_REGISTRY,
    summary: {
      postsAnalysed: scores.length,
      totalEngagement: fmtCompact(totalEngagement),
      avgEngagementPerPost: fmtCompact(scores.length ? totalEngagement / scores.length : 0),
      avgAuthenticity: round(mean(agencies.map((a) => a.auth))),
      avgPerformance: round(mean(agencies.map((a) => a.perf))),
      avgEfficiency: null,
      flaggedAgencies,
      topAgency: agencies[0] ? { name: agencies[0].name, score: agencies[0].score } : null,
    },
  };
}

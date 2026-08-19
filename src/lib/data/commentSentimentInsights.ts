// Reader for the `comment_sentiment` table, which until now was written by
// backfill-comment-sentiment and read by nothing at all. Zero marginal cost: every row this
// surfaces was already scraped and already classified.
//
// Deliberately framed as REPORTING, not detection. A live check of the production data
// (2026-08-07) found 1,636 classified comments split 1,435 pos / 173 neu / 28 neg, and those
// 28 negatives belong to 28 *different* handles — not one repeat offender exists. So this
// file surfaces what the negativity actually is and whether its rate is moving; it does not
// pretend to model a per-person "hater" signal that the data cannot support. The repeat-critic
// section below is built anyway, because it costs nothing and becomes meaningful if volume
// ever grows — but it renders an honest empty state rather than an impressive-looking zero.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TREND_DAYS = 14;
// The whole point is that this list is short enough to read end to end. If it ever isn't,
// that is itself the finding — the UI says so rather than silently truncating.
const NEGATIVE_FEED_LIMIT = 100;
// Two negative comments from the same handle is the minimum that can even be called a
// pattern. Set here rather than inline so the (currently empty) result is explainable.
const MIN_NEGATIVES_FOR_REPEAT_CRITIC = 2;

export interface NegativeCommentRow {
  id: string;
  authorHandle: string | null;
  /** Classifier confidence, not severity — 0.9 means "confidently negative", not "worse". */
  score: number;
  /**
   * Null once prune-raw-payloads has cleared it past COMMENT_RETENTION_DAYS. The row is
   * kept deliberately (see that cron's note), so an old negative still counts toward the
   * rate even when its words are gone — the UI has to render that case, not assume text.
   */
  text: string | null;
  commentedAt: string | null;
  postExternalUrl: string | null;
  postAuthorHandle: string | null;
  campaignName: string | null;
}

export interface RepeatCriticRow {
  authorHandle: string;
  negativeCount: number;
  postCount: number;
}

export interface NegativeRatePoint {
  date: string;
  classified: number;
  negative: number;
  negativePct: number;
}

export interface CommentSentimentTotals {
  classified: number;
  positive: number;
  neutral: number;
  negative: number;
  negativePct: number;
  distinctCommenters: number;
}

/**
 * Context for reading the numbers above honestly.
 *
 * Without this, "1.7% negative" looks like a finding about the audience. With it, it's
 * visibly a finding about coverage: comments are scraped only for campaign/agency posts,
 * once per post ever, and replies are not scraped at all
 * (`includeNestedComments: false` in apify-public-content.ts) — which is where pile-on
 * behaviour actually lives.
 */
export interface CommentCoverage {
  postsWithComments: number;
  postsEligible: number;
  commentsStored: number;
  commentsUnclassified: number;
}

export interface CommentSentimentInsights {
  campaigns: { id: string; name: string }[];
  campaignId: string | null;
  totals: CommentSentimentTotals;
  negativeRateTrend: NegativeRatePoint[];
  negativeComments: NegativeCommentRow[];
  negativeCommentsTruncated: boolean;
  repeatCritics: RepeatCriticRow[];
  coverage: CommentCoverage;
}

function emptyTotals(): CommentSentimentTotals {
  return { classified: 0, positive: 0, neutral: 0, negative: 0, negativePct: 0, distinctCommenters: 0 };
}

export async function getCommentSentimentInsights(campaignId?: string): Promise<CommentSentimentInsights> {
  // Scoping a CommentSentiment row to a campaign is a two-hop join (comment -> post ->
  // campaign); Prisma expresses it as a nested relation filter, which keeps it one query
  // rather than fetching post ids first and passing them back in.
  const scope = campaignId ? { postComment: { post: { campaignId } } } : {};

  const [campaigns, lightRows, coverage] = await Promise.all([
    prisma.campaign.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Deliberately split from the negative feed below: this pass covers every classified
    // comment in scope and is only ever used for counting, so it must not pull `text` (the
    // one genuinely large column) for thousands of rows to produce a handful of integers.
    prisma.commentSentiment.findMany({
      where: scope,
      select: {
        label: true,
        authorHandle: true,
        postComment: { select: { postedAt: true, scrapedAt: true } },
      },
    }),
    readCoverage(campaignId),
  ]);

  if (lightRows.length === 0) {
    return {
      campaigns,
      campaignId: campaignId ?? null,
      totals: emptyTotals(),
      negativeRateTrend: [],
      negativeComments: [],
      negativeCommentsTruncated: false,
      repeatCritics: [],
      coverage,
    };
  }

  const totals = emptyTotals();
  totals.classified = lightRows.length;
  const commenters = new Set<string>();

  // Zero-filled so the sparkline always spans the same window and two campaigns are
  // directly comparable — same convention as keywords.ts's trend.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const buckets = days.map(() => ({ classified: 0, negative: 0 }));

  for (const row of lightRows) {
    if (row.label === "pos") totals.positive++;
    else if (row.label === "neu") totals.neutral++;
    else totals.negative++;
    if (row.authorHandle) commenters.add(row.authorHandle.toLowerCase());

    // The comment's own posting time, not analyzedAt — analyzedAt reflects when a backfill
    // happened to run, which clusters every comment from a chunk onto one day and would
    // invent a spike that never happened. Same reasoning as campaigns.ts's sentimentTrend.
    const when = row.postComment.postedAt ?? row.postComment.scrapedAt;
    const idx = when ? dayIndex.get(when.toISOString().slice(0, 10)) : undefined;
    if (idx !== undefined) {
      buckets[idx].classified++;
      if (row.label === "neg") buckets[idx].negative++;
    }
  }

  totals.distinctCommenters = commenters.size;
  totals.negativePct = totals.classified
    ? Math.round((totals.negative / totals.classified) * 1000) / 10
    : 0;

  const negativeRateTrend: NegativeRatePoint[] = days.map((date, i) => ({
    date,
    classified: buckets[i].classified,
    negative: buckets[i].negative,
    negativePct: buckets[i].classified
      ? Math.round((buckets[i].negative / buckets[i].classified) * 1000) / 10
      : 0,
  }));

  // Second pass, negatives only — this is the one that pulls comment text and post details,
  // and it is bounded. Ordered newest-first: what people are saying now is the point.
  const negativeRows = await prisma.commentSentiment.findMany({
    where: { ...scope, label: "neg" },
    take: NEGATIVE_FEED_LIMIT + 1,
    orderBy: { postComment: { postedAt: "desc" } },
    select: {
      postCommentId: true,
      authorHandle: true,
      score: true,
      postComment: {
        select: {
          text: true,
          postedAt: true,
          post: { select: { externalUrl: true, authorHandle: true, campaign: { select: { name: true } } } },
        },
      },
    },
  });
  const negativeCommentsTruncated = negativeRows.length > NEGATIVE_FEED_LIMIT;
  const negativeComments: NegativeCommentRow[] = negativeRows.slice(0, NEGATIVE_FEED_LIMIT).map((r) => ({
    id: r.postCommentId,
    authorHandle: r.authorHandle,
    score: r.score,
    text: r.postComment.text,
    commentedAt: r.postComment.postedAt ? r.postComment.postedAt.toISOString() : null,
    postExternalUrl: r.postComment.post.externalUrl,
    postAuthorHandle: r.postComment.post.authorHandle,
    campaignName: r.postComment.post.campaign?.name ?? null,
  }));

  return {
    campaigns,
    campaignId: campaignId ?? null,
    totals,
    negativeRateTrend,
    negativeComments,
    negativeCommentsTruncated,
    repeatCritics: await readRepeatCritics(campaignId),
    coverage,
  };
}

/**
 * Handles with more than one negative comment.
 *
 * Grouped in the database over ALL negatives rather than derived from the bounded feed
 * above — a repeat critic whose comments happen to fall outside the newest 100 is exactly
 * the one worth knowing about, so deriving this from a truncated list would hide the only
 * case it exists to find.
 */
async function readRepeatCritics(campaignId?: string): Promise<RepeatCriticRow[]> {
  const grouped = await prisma.commentSentiment.groupBy({
    by: ["authorHandle"],
    where: {
      label: "neg",
      authorHandle: { not: null },
      ...(campaignId ? { postComment: { post: { campaignId } } } : {}),
    },
    _count: { _all: true },
    having: { authorHandle: { _count: { gte: MIN_NEGATIVES_FOR_REPEAT_CRITIC } } },
  });
  if (grouped.length === 0) return [];

  // Distinct posts per handle, so "5 negatives" on one post (an argument in one thread)
  // reads differently from "5 negatives across 5 posts" (someone following the campaign
  // around). Only run for the handles that already qualify, so it stays a small query.
  const handles = grouped.map((g) => g.authorHandle).filter((h): h is string => h !== null);
  const rows = await prisma.commentSentiment.findMany({
    where: { label: "neg", authorHandle: { in: handles } },
    select: { authorHandle: true, postComment: { select: { postId: true } } },
  });
  const postsByHandle = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.authorHandle) continue;
    const set = postsByHandle.get(r.authorHandle) ?? new Set<string>();
    set.add(r.postComment.postId);
    postsByHandle.set(r.authorHandle, set);
  }

  return grouped
    .filter((g): g is typeof g & { authorHandle: string } => g.authorHandle !== null)
    .map((g) => ({
      authorHandle: g.authorHandle,
      negativeCount: g._count._all,
      postCount: postsByHandle.get(g.authorHandle)?.size ?? 1,
    }))
    .sort((a, b) => b.negativeCount - a.negativeCount || b.postCount - a.postCount);
}

async function readCoverage(campaignId?: string): Promise<CommentCoverage> {
  // "Eligible" means what the pipeline actually attempts: comment scraping is wired only to
  // campaign/agency-sourced posts (see backfill-sentiment's scope note). Counting against
  // every post in the table would understate coverage against a denominator the pipeline
  // was never aiming at.
  const postScope: Prisma.PostWhereInput = campaignId
    ? { campaignId }
    : { source: { in: ["campaign", "agency"] } };
  const [postsEligible, postsWithComments, commentsStored, commentsUnclassified] = await Promise.all([
    prisma.post.count({ where: postScope }),
    prisma.post.count({ where: { ...postScope, postComments: { some: {} } } }),
    prisma.postComment.count({ where: { post: postScope } }),
    // text: not null matters — a comment pruned before it was ever classified can never be
    // classified now, so counting it as pending backlog would be permanently misleading.
    prisma.postComment.count({ where: { post: postScope, sentiment: null, text: { not: null } } }),
  ]);
  return { postsEligible, postsWithComments, commentsStored, commentsUnclassified };
}

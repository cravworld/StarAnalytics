// Keyword/topic trends — reads Sentiment.keywords (already extracted by the Claude sentiment
// provider alongside every post's label, see claude-sentiment.ts) across campaigns instead of
// the single campaign detail page's top-8 pills (campaigns.ts). Zero new scraping/API cost:
// this is a read over data already stored.
//
// Keywords are free-text LLM output, not a controlled vocabulary — near-duplicate phrasing
// ("can't wait" vs "cant wait") won't merge here beyond simple normalization (lowercase, trim,
// strip surrounding punctuation). Real semantic clustering would need embeddings or another LLM
// pass; deliberately not done here to keep this feature at zero marginal cost.
import { prisma } from "@/lib/prisma";

const TREND_DAYS = 14;
const TOP_N = 30;

const TRIM_PUNCT = /^[\s"'.,!?;:()]+|[\s"'.,!?;:()]+$/g;

function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(TRIM_PUNCT, "");
}

export interface KeywordTrendRow {
  keyword: string;
  count: number;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
  // One entry per day in the trailing TREND_DAYS window, oldest first, zero-filled — every
  // keyword's sparkline covers the same window so they're directly comparable at a glance.
  sparkline: number[];
}

export interface KeywordTrendsResult {
  keywords: KeywordTrendRow[];
  campaigns: { id: string; name: string }[];
  campaignId: string | null;
  totalClassifiedPosts: number;
}

interface KeywordAgg {
  count: number;
  pos: number;
  neu: number;
  neg: number;
  sparkline: number[];
}

export async function getKeywordTrends(campaignId?: string): Promise<KeywordTrendsResult> {
  const [sentiments, campaigns] = await Promise.all([
    prisma.sentiment.findMany({
      where: campaignId ? { post: { campaignId } } : {},
      select: { keywords: true, label: true, post: { select: { postedAt: true, scrapedAt: true } } },
    }),
    prisma.campaign.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  if (sentiments.length === 0) {
    return { keywords: [], campaigns, campaignId: campaignId ?? null, totalClassifiedPosts: 0 };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const byKeyword = new Map<string, KeywordAgg>();

  for (const s of sentiments) {
    // postedAt (real campaign timeline) preferred over scrapedAt (when a backfill happened to
    // run) — same convention as campaigns.ts's own sentimentTrend bucketing.
    const day = (s.post.postedAt ?? s.post.scrapedAt)?.toISOString().slice(0, 10);
    const dIdx = day ? dayIndex.get(day) : undefined;

    // Dedup within one post's own keyword list — the classifier could plausibly repeat a term,
    // and we only want to count "this post touched this topic" once per post.
    const seenInRow = new Set<string>();
    for (const raw of s.keywords) {
      const kw = normalizeKeyword(raw);
      if (!kw || seenInRow.has(kw)) continue;
      seenInRow.add(kw);

      const agg = byKeyword.get(kw) ?? { count: 0, pos: 0, neu: 0, neg: 0, sparkline: new Array(TREND_DAYS).fill(0) };
      agg.count++;
      if (s.label === "pos") agg.pos++;
      else if (s.label === "neu") agg.neu++;
      else agg.neg++;
      if (dIdx !== undefined) agg.sparkline[dIdx]++;
      byKeyword.set(kw, agg);
    }
  }

  const keywords: KeywordTrendRow[] = Array.from(byKeyword.entries())
    .map(([keyword, agg]) => ({
      keyword,
      count: agg.count,
      positivePct: Math.round((agg.pos / agg.count) * 100),
      neutralPct: Math.round((agg.neu / agg.count) * 100),
      negativePct: Math.round((agg.neg / agg.count) * 100),
      sparkline: agg.sparkline,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N);

  return { keywords, campaigns, campaignId: campaignId ?? null, totalClassifiedPosts: sentiments.length };
}

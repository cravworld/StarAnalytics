// Buzz-score history — computeBuzzScore() (buzzScore.ts) stays a stateless pure function,
// this is the history it never had: buzz score is recomputed live on every page load with
// nothing persisted anywhere. Same shape/reasoning as accountSnapshots.ts (follower
// history), captured by a dedicated daily cron (api/cron/snapshot-buzz/route.ts) rather than
// on page view — a campaign nobody happens to check for a week still gets a real daily data
// point instead of a gap.
import { prisma } from "@/lib/prisma";
import type { BuzzScoreResult } from "@/lib/scoring/buzzScore";

export async function recordBuzzSnapshot(campaignId: string, buzz: BuzzScoreResult): Promise<void> {
  await prisma.campaignBuzzSnapshot.create({
    data: {
      campaignId,
      score: buzz.score,
      sizeComponent: buzz.components.size,
      sentimentComponent: buzz.components.sentiment,
      momentumComponent: buzz.components.momentum,
    },
  });
}

export interface BuzzTrend {
  values: number[]; // chronological, oldest first, capped at MAX_POINTS
}

const MAX_POINTS = 30;

export async function getBuzzTrend(campaignId: string): Promise<BuzzTrend> {
  const rows = await prisma.campaignBuzzSnapshot.findMany({
    where: { campaignId },
    orderBy: { capturedAt: "asc" },
    select: { score: true },
  });
  return { values: rows.slice(-MAX_POINTS).map((r) => r.score) };
}

// Real week-over-week delta for the digest — the closest snapshot to "at least
// MIN_AGE_DAYS old," not just "oldest of the last N points" (that's what getBuzzTrend's
// sparkline is for; a sparkline and a "vs last week" claim are different questions).
// MIN_AGE_DAYS is 5, not 7, to tolerate the daily cron landing a day or two off a clean
// weekly cadence rather than requiring an exact 7-day match that might not exist.
const MIN_AGE_DAYS = 5;

// Returns null — not a fabricated 0 — when no snapshot old enough exists yet. The first
// digest/trend view after this feature ships has genuinely no history to compare against;
// that must render as "no history yet," same discipline as sentiment's null state.
export async function getBuzzWeekAgoDelta(campaignId: string, currentScore: number): Promise<number | null> {
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
  const row = await prisma.campaignBuzzSnapshot.findFirst({
    where: { campaignId, capturedAt: { lte: cutoff } },
    orderBy: { capturedAt: "desc" }, // most recent snapshot that's still old enough to count
    select: { score: true },
  });
  return row ? currentScore - row.score : null;
}

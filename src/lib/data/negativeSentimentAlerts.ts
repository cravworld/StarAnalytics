// Negative-sentiment spike alerting — the one part of the comment_sentiment data that is
// worth acting on automatically.
//
// Deliberately a RATE alert, not a per-person one. The production data has 28 negative
// comments spread across 28 distinct handles, so no individual commenter is a signal; a
// move in the negative *rate* is. This also means the alert stays meaningful if the pipeline
// starts capturing more comments, whereas a per-person rule would just get noisier.
//
// Reuses the existing Alert model + notifier plumbing rather than adding a parallel
// mechanism — same shape as fanPageAlerts.ts, including "the row is written first and
// deliveredAt is only stamped once send() actually resolves".
import { prisma } from "@/lib/prisma";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";

export const NEGATIVE_SPIKE_ALERT_TYPE = "negative_sentiment_spike";

export interface NegativeSpikeParams {
  recentWindowHours: number;
  baselineWindowDays: number;
  /**
   * Absolute floor on negatives before anything can fire. Without it, 2 negatives out of 3
   * comments is a 67% rate and would page someone about a rounding error.
   */
  minRecentNegatives: number;
  /** And a floor on the denominator, so the rate itself is a real measurement. */
  minRecentClassified: number;
  /** Recent rate must be this multiple of the baseline rate. */
  multiplier: number;
  /**
   * ...or exceed this outright. A campaign whose baseline is already bad has no useful
   * multiple to exceed — 30% negative is worth knowing about even if last week was 25%.
   */
  floorPct: number;
}

// Tuned against real observed data, not picked for roundness: the live corpus sits at 1.7%
// negative overall, so 2x that is ~3.4% and the 10% floor is a genuinely different regime.
// minRecentClassified of 20 is the smallest denominator where a single comment doesn't move
// the rate by more than 5 points.
export const DEFAULT_NEGATIVE_SPIKE_PARAMS: NegativeSpikeParams = {
  recentWindowHours: 24,
  baselineWindowDays: 14,
  minRecentNegatives: 3,
  minRecentClassified: 20,
  multiplier: 2,
  floorPct: 10,
};

export interface NegativeSpikeInput {
  recentNegative: number;
  recentClassified: number;
  baselineNegative: number;
  baselineClassified: number;
}

export interface NegativeSpikeVerdict {
  shouldAlert: boolean;
  recentPct: number;
  /** Null when the baseline window holds no classified comments to compare against. */
  baselinePct: number | null;
  reason: "below_minimums" | "above_floor" | "above_baseline_multiple" | "within_normal_range";
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/**
 * Pure, so the thresholds are testable without a database — same discipline as
 * quotaBreaker's isQuotaCircuitOpen and the scoring engine's scorePost.
 */
export function evaluateNegativeSpike(
  { recentNegative, recentClassified, baselineNegative, baselineClassified }: NegativeSpikeInput,
  params: NegativeSpikeParams = DEFAULT_NEGATIVE_SPIKE_PARAMS,
): NegativeSpikeVerdict {
  const recentPct = pct(recentNegative, recentClassified);
  const baselinePct = baselineClassified > 0 ? pct(baselineNegative, baselineClassified) : null;

  // Minimums first. Both must hold before any rate comparison is meaningful, and checking
  // them up front is what stops a tiny sample from ever reaching the comparisons below.
  if (recentNegative < params.minRecentNegatives || recentClassified < params.minRecentClassified) {
    return { shouldAlert: false, recentPct, baselinePct, reason: "below_minimums" };
  }
  if (recentPct >= params.floorPct) {
    return { shouldAlert: true, recentPct, baselinePct, reason: "above_floor" };
  }
  // A zero baseline is not a free multiple: any negative at all would be infinitely above
  // it. The floor check above is the only route to an alert in that case.
  if (baselinePct !== null && baselinePct > 0 && recentPct >= baselinePct * params.multiplier) {
    return { shouldAlert: true, recentPct, baselinePct, reason: "above_baseline_multiple" };
  }
  return { shouldAlert: false, recentPct, baselinePct, reason: "within_normal_range" };
}

export function buildSpikeMessage(
  campaignName: string,
  verdict: NegativeSpikeVerdict,
  input: NegativeSpikeInput,
  params: NegativeSpikeParams = DEFAULT_NEGATIVE_SPIKE_PARAMS,
): string {
  const head = `${campaignName}: ${input.recentNegative} of ${input.recentClassified} new comments negative (${verdict.recentPct}%) in the last ${params.recentWindowHours}h`;
  return verdict.baselinePct !== null
    ? `${head} — up from ${verdict.baselinePct}% over the prior ${params.baselineWindowDays} days.`
    : `${head}. No prior ${params.baselineWindowDays}-day baseline to compare against.`;
}

interface WindowCounts {
  classified: number;
  negative: number;
}

/**
 * Counts classified comments in a time window for one campaign.
 *
 * Windowed on the comment's own `postedAt`, never on `analyzedAt`: a backfill classifies
 * thousands of old comments in one run, so an analyzedAt window would report every one of
 * them as having "just arrived" and fire a spike alert for a batch job. Comments with no
 * postedAt are excluded rather than guessed at — they can't be placed on a timeline, and
 * silently bucketing them as "now" is the same bug in a different place.
 */
async function countWindow(campaignId: string, from: Date, to: Date): Promise<WindowCounts> {
  const where = {
    postComment: { postedAt: { gte: from, lt: to }, post: { campaignId } },
  };
  const [classified, negative] = await Promise.all([
    prisma.commentSentiment.count({ where }),
    prisma.commentSentiment.count({ where: { ...where, label: "neg" as const } }),
  ]);
  return { classified, negative };
}

export interface NegativeSpikeResult {
  campaignId: string;
  campaignName: string;
  alerted: boolean;
  reason: NegativeSpikeVerdict["reason"] | "already_alerted";
  recentPct: number;
}

/**
 * Checks every live campaign and raises at most one alert per campaign per recent window.
 *
 * Called from the comment-sentiment backfill cron — that is the only place new
 * CommentSentiment rows appear, so it is the only moment this verdict can change.
 */
export async function checkNegativeSentimentSpikes(
  params: NegativeSpikeParams = DEFAULT_NEGATIVE_SPIKE_PARAMS,
): Promise<NegativeSpikeResult[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { status: "live" },
    select: { id: true, name: true },
  });
  if (campaigns.length === 0) return [];

  const now = new Date();
  const recentFrom = new Date(now.getTime() - params.recentWindowHours * 3_600_000);
  const baselineFrom = new Date(recentFrom.getTime() - params.baselineWindowDays * 24 * 3_600_000);

  const notifier = getNotifierProvider();
  const results: NegativeSpikeResult[] = [];

  for (const campaign of campaigns) {
    // Baseline deliberately ends where the recent window begins, so the two never overlap —
    // otherwise a spike partly dilutes the baseline it is being measured against and the
    // multiple understates it.
    const [recent, baseline] = await Promise.all([
      countWindow(campaign.id, recentFrom, now),
      countWindow(campaign.id, baselineFrom, recentFrom),
    ]);

    const input: NegativeSpikeInput = {
      recentNegative: recent.negative,
      recentClassified: recent.classified,
      baselineNegative: baseline.negative,
      baselineClassified: baseline.classified,
    };
    const verdict = evaluateNegativeSpike(input, params);
    if (!verdict.shouldAlert) {
      results.push({ campaignId: campaign.id, campaignName: campaign.name, alerted: false, reason: verdict.reason, recentPct: verdict.recentPct });
      continue;
    }

    // One alert per campaign per window. The cron runs every minute, so without this a real
    // spike would re-alert 1,440 times a day — the dedup is what makes it safe to check on
    // that cadence at all.
    const existing = await prisma.alert.findFirst({
      where: { type: NEGATIVE_SPIKE_ALERT_TYPE, campaignId: campaign.id, createdAt: { gte: recentFrom } },
      select: { id: true },
    });
    if (existing) {
      results.push({ campaignId: campaign.id, campaignName: campaign.name, alerted: false, reason: "already_alerted", recentPct: verdict.recentPct });
      continue;
    }

    const alert = await prisma.alert.create({
      data: {
        type: NEGATIVE_SPIKE_ALERT_TYPE,
        campaignId: campaign.id,
        message: buildSpikeMessage(campaign.name, verdict, input, params),
      },
    });
    results.push({ campaignId: campaign.id, campaignName: campaign.name, alerted: true, reason: verdict.reason, recentPct: verdict.recentPct });

    // Delivery failure must not lose the alert or fail the cron — identical handling to
    // fanPageAlerts.ts: the row stands, deliveredAt simply stays null.
    try {
      await notifier.send({
        id: alert.id,
        type: alert.type,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
      });
      await prisma.alert.update({
        where: { id: alert.id },
        data: { deliveredAt: new Date(), channel: getNotifierChannel() },
      });
    } catch (err) {
      console.error(`[negativeSentimentAlerts] delivery failed for alert ${alert.id}:`, err);
    }
  }

  return results;
}

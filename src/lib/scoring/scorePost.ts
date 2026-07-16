import type { CohortStats, Flag, PostForScoring, ScoreResult, ThresholdConfigParams } from "./types";

// Off-hours is a binary signal (posted in the window or not) with no natural
// magnitude, so it keeps a flat per-severity penalty. Velocity's penalty is
// computed from its z-score instead — see ThresholdConfigParams.velocityPenaltyPerZ.
const OFF_HOURS_PENALTY: Record<Flag["severity"], number> = { low: 5, medium: 15, high: 30 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function zscore(value: number, m: number, sd: number): number {
  if (sd === 0) return 0; // degenerate cohort (e.g. a single-post run) — no signal, not NaN/Infinity
  return (value - m) / sd;
}

// IST is UTC+5:30, no DST — a fixed offset is exact, not an approximation.
const IST_OFFSET_MINUTES = 5 * 60 + 30;

function istHourOf(postedAt: string | null): number | null {
  if (!postedAt) return null;
  const t = new Date(postedAt);
  if (Number.isNaN(t.getTime())) return null;
  const istMinutes = (t.getUTCHours() * 60 + t.getUTCMinutes() + IST_OFFSET_MINUTES) % (24 * 60);
  return Math.floor(istMinutes / 60);
}

/**
 * Pure, deterministic scoring — no DB calls, no side effects, no randomness.
 * Given the same (post, cohort, config) it always returns the same result, so
 * historical runs can be replayed exactly when auditing a dispute.
 *
 * Two of the DPR's four flag types are implemented here (see FLAG_REGISTRY for
 * the other two, which are coverage gaps, not signals that came back clean):
 *
 * - engagement_velocity_anomaly: the DPR's literal metric ("10K likes in 2
 *   min") needs a re-scrape time series agency posts don't have (scraped
 *   once). The proxy used instead is like:comment ratio, z-scored against the
 *   cross-agency cohort — purchased likes don't buy proportionate genuine
 *   comments. Evidence is stored so this substitution is visible, not hidden.
 * - off_hours_engagement_spike: posted_at's IST hour falls in the configured
 *   overnight window. posted_at was already verified reliable in Phase 1.
 *
 * Cohort is cross-agency (all posts in the run), not per-agency: scoring an
 * agency against its own mean would let an agency that buys engagement on
 * most of its posts corrupt its own baseline and never flag itself.
 */
export function scorePost(post: PostForScoring, cohort: CohortStats, config: ThresholdConfigParams): ScoreResult {
  const likes = post.likes ?? 0;
  const comments = post.comments ?? 0;
  const engagement = likes + comments;
  const likeToCommentRatio = likes / Math.max(comments, 1);

  const zEngagement = zscore(engagement, cohort.meanEngagement, cohort.stdEngagement);
  const zRatio = zscore(likeToCommentRatio, cohort.meanLikeToCommentRatio, cohort.stdLikeToCommentRatio);

  const flags: Flag[] = [];
  let authPenalty = 0;

  if (zRatio > config.velocityZCutoffMedium) {
    const penalty = clamp(zRatio * config.velocityPenaltyPerZ, 0, 100);
    authPenalty += penalty;
    flags.push({
      type: "engagement_velocity_anomaly",
      severity: zRatio > config.velocityZCutoffHigh ? "high" : "medium",
      evidence: {
        note: "Proxy signal: like:comment ratio vs. campaign cohort — no re-scrape time series exists for agency posts this phase.",
        likes,
        comments,
        likeToCommentRatio: Math.round(likeToCommentRatio * 100) / 100,
        cohortMeanRatio: Math.round(cohort.meanLikeToCommentRatio * 100) / 100,
        zScore: Math.round(zRatio * 100) / 100,
        authPenaltyApplied: Math.round(penalty * 100) / 100,
      },
    });
  }

  const istHour = istHourOf(post.postedAt);
  if (istHour !== null && istHour >= config.offHoursStartIst && istHour < config.offHoursEndIst) {
    authPenalty += OFF_HOURS_PENALTY[config.offHoursSeverity];
    flags.push({
      type: "off_hours_engagement_spike",
      severity: config.offHoursSeverity,
      evidence: {
        postedAtUtc: post.postedAt,
        postedAtIstHour: istHour,
        window: [config.offHoursStartIst, config.offHoursEndIst],
      },
    });
  }

  const authScore = clamp(100 - authPenalty, 0, 100);
  const perfScore = clamp(50 + zEngagement * 15, 0, 100);
  // Not evaluated this phase — see EFFICIENCY_NOT_EVALUATED_REASON in types.ts
  // for why, and why a flat placeholder number was rejected too.
  const effScore = null;

  // Efficiency's weight is excluded from totalScore while effScore is null —
  // performance/authenticity are renormalized to sum to 1 rather than left at
  // their nominal 0.5/0.3 (which would silently discard 20% of the score's
  // weight instead of redistributing it).
  const activeWeight = config.weights.performance + config.weights.authenticity;
  const totalScore = (perfScore * config.weights.performance + authScore * config.weights.authenticity) / activeWeight;

  return { perfScore, authScore, effScore, totalScore, flags };
}

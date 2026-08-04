import type { CohortStats, Flag, PostForScoring, ScoreResult, ThresholdConfigParams } from "./types";

// Off-hours is a binary signal (posted in the window or not) with no natural
// magnitude, so it keeps a flat per-severity penalty. Velocity's penalty is
// computed from its z-score instead — see ThresholdConfigParams.velocityPenaltyPerZ.
const OFF_HOURS_PENALTY: Record<Flag["severity"], number> = { low: 5, medium: 15, high: 30 };

// generic_comment_pattern's own flat per-severity penalty — higher ceiling than off-hours
// because a cross-post exact-text duplicate is close to unfakeable-by-coincidence evidence
// (see detectGenericCommentPattern's "high" case), stronger than a timing coincidence.
const GENERIC_COMMENT_PENALTY: Record<Flag["severity"], number> = { low: 10, medium: 20, high: 35 };

// Comments shorter than this (after normalization) are excluded from duplicate-detection
// entirely — short organic reactions ("🔥🔥🔥", "Nice one", "❤️") are genuinely common across
// unrelated fans and unrelated posts; flagging those would be false positives the Authenticity
// Audit's whole "must survive a dispute" bar can't tolerate. Longer text repeated verbatim is a
// much cleaner signal: real people don't independently type the same 12+ character sentence.
const MIN_COMMENT_LENGTH_FOR_DUP_CHECK = 12;

function normalizeCommentText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

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

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// crossPostDuplicateCounts: normalized comment text -> number of DISTINCT posts (in this same
// scoring run) it appeared on. Built once by the caller across the whole run (see agency.ts) —
// scorePost stays a pure function of its explicit inputs, no DB access inside this file.
function detectGenericCommentPattern(
  comments: { text: string | null; authorHandle: string | null }[],
  crossPostDuplicateCounts: Map<string, number>,
  config: ThresholdConfigParams,
): Flag | null {
  const normalized = comments
    .filter((c) => !!c.text && c.text.trim().length > 0)
    .map((c) => ({ authorHandle: c.authorHandle, norm: normalizeCommentText(c.text as string) }))
    .filter((c) => c.norm.length >= MIN_COMMENT_LENGTH_FOR_DUP_CHECK);
  if (normalized.length === 0) return null;

  const withinPostGroups = new Map<string, typeof normalized>();
  for (const c of normalized) {
    const group = withinPostGroups.get(c.norm) ?? [];
    group.push(c);
    withinPostGroups.set(c.norm, group);
  }

  // Within-post: the largest exact-duplicate cluster on THIS post.
  let withinPostMax = 0;
  let withinPostText = "";
  let withinPostHandles: string[] = [];
  for (const [norm, group] of withinPostGroups) {
    if (group.length > withinPostMax) {
      withinPostMax = group.length;
      withinPostText = norm;
      withinPostHandles = group.map((c) => c.authorHandle).filter((h): h is string => !!h);
    }
  }

  // Cross-post: same exact text also seen on other posts scored in this run.
  let crossPostCount = 0;
  let crossPostText = "";
  let crossPostHandles: string[] = [];
  for (const [norm, group] of withinPostGroups) {
    const runCount = crossPostDuplicateCounts.get(norm) ?? 0;
    if (runCount > crossPostCount) {
      crossPostCount = runCount;
      crossPostText = norm;
      crossPostHandles = group.map((c) => c.authorHandle).filter((h): h is string => !!h);
    }
  }

  const withinFires = withinPostMax >= config.genericCommentMinDuplicates;
  const crossFires = crossPostCount >= 2; // same exact text also lands on ≥1 other post
  if (!withinFires && !crossFires) return null;

  // Cross-post exact-text duplication across unrelated posts is close to unfakeable-by-
  // coincidence — real people don't independently type the same 12+ character sentence on two
  // different posts. It outranks a same-post cluster unless that cluster is itself very large.
  const severity: Flag["severity"] =
    crossFires || withinPostMax >= config.genericCommentMinDuplicates * 2 ? "high" : "medium";

  return {
    type: "generic_comment_pattern",
    severity,
    evidence: {
      note: 'Comments under 12 characters are excluded — short reactions ("nice", "❤️", "🔥🔥🔥") are common on their own and not evidence.',
      ...(withinFires
        ? {
            withinPostDuplicateCount: withinPostMax,
            withinPostDuplicateText: truncate(withinPostText),
            withinPostHandles: withinPostHandles.slice(0, 10),
          }
        : {}),
      ...(crossFires
        ? {
            crossPostDuplicatePostCount: crossPostCount,
            crossPostDuplicateText: truncate(crossPostText),
            crossPostHandles: crossPostHandles.slice(0, 10),
          }
        : {}),
    },
  };
}

/**
 * Pure, deterministic scoring — no DB calls, no side effects, no randomness.
 * Given the same (post, cohort, config, crossPostDuplicateCounts) it always
 * returns the same result, so historical runs can be replayed exactly when
 * auditing a dispute.
 *
 * Three of the DPR's four flag types are implemented here (see FLAG_REGISTRY
 * for the remaining one, which is a coverage gap, not a signal that came back
 * clean):
 *
 * - engagement_velocity_anomaly: the DPR's literal metric ("10K likes in 2
 *   min") needs a re-scrape time series agency posts don't have (scraped
 *   once). The proxy used instead is like:comment ratio, z-scored against the
 *   cross-agency cohort — purchased likes don't buy proportionate genuine
 *   comments. Evidence is stored so this substitution is visible, not hidden.
 * - off_hours_engagement_spike: posted_at's IST hour falls in the configured
 *   overnight window. posted_at was already verified reliable in Phase 1.
 * - generic_comment_pattern: exact-duplicate comment text, either clustered on
 *   one post or repeated verbatim across different posts in the same run —
 *   see detectGenericCommentPattern above. Needs post.commentTexts, which the
 *   caller only has once comments are actually scraped (see agency.ts).
 *
 * Cohort is cross-agency (all posts in the run), not per-agency: scoring an
 * agency against its own mean would let an agency that buys engagement on
 * most of its posts corrupt its own baseline and never flag itself.
 */
export function scorePost(
  post: PostForScoring,
  cohort: CohortStats,
  config: ThresholdConfigParams,
  crossPostDuplicateCounts: Map<string, number> = new Map(),
): ScoreResult {
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

  const commentFlag = detectGenericCommentPattern(post.commentTexts ?? [], crossPostDuplicateCounts, config);
  if (commentFlag) {
    authPenalty += GENERIC_COMMENT_PENALTY[commentFlag.severity];
    flags.push(commentFlag);
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

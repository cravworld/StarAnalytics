// Scoutline's per-account "Buzz Factor" — one 0-100 composite from the
// easy_scraper/instagram-profile-engagement-analytics actor's own metrics. Same discipline
// as buzzScore.ts: pure function, no DB calls, first-guess weights not a calibrated model,
// and a signal that can't be measured for this account is excluded and the rest
// renormalized — never faked as a neutral midpoint.
//
// No authenticity/bot-detection component here (deliberately, per 2026-08-17 direction) —
// this actor returns aggregate stats only, no comment text to run the existing
// generic_comment_pattern detector against. If that's added later it slots in as a fifth
// weighted component, same pattern as the others.

const REACH_REFERENCE_FOLLOWERS = 500_000; // followers mapped to ~100 on the reach sub-score
const ENGAGEMENT_REFERENCE_PCT = 10; // engagement rate mapped to ~100 on the engagement sub-score

// Default weights — editable per batch from the Scoutline settings panel (ScoutSettings),
// not a fixed constant like buzzScore.ts's. Exported so the settings UI can seed its form
// with the same numbers this function would otherwise fall back to.
export const DEFAULT_WEIGHTS = { engagement: 0.4, reach: 0.3, consistency: 0.15, contentMix: 0.15 };
export type InfluencerWeights = typeof DEFAULT_WEIGHTS;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Log-scaled, not linear — this list alone spans ~1k to 500k+ followers, and a linear
// scale would flatten every micro/mid account near 0. Same shape as buzzScore.ts's sizeScore.
function reachScore(followers: number): number {
  if (followers <= 0) return 0;
  return clamp((100 * Math.log10(followers + 1)) / Math.log10(REACH_REFERENCE_FOLLOWERS + 1), 0, 100);
}

// Also log-scaled: the actor's own numbers show engagement rate can legitimately exceed
// 100% for a small viral-reels account (non-follower reach via the algorithm, not a bug —
// confirmed against real accounts in this list), so a linear 0-100% scale would clip most
// of the interesting range at the top.
function engagementScore(ratePct: number): number {
  if (ratePct <= 0) return 0;
  return clamp((100 * Math.log10(ratePct + 1)) / Math.log10(ENGAGEMENT_REFERENCE_PCT + 1), 0, 100);
}

// Actor's own engagement_consistency_score is already 0-1, clipped (1 - stddev/mean of
// per-post engagement). Directly rescaled, not reinterpreted — the actor did the real work.
function consistencyScore(score01: number): number {
  return clamp(score01 * 100, 0, 100);
}

// % of analyzed posts that were Reels/clips. Reels get the most algorithmic discovery
// (non-follower reach) of any Instagram post type today, so a reel-heavy account scores
// higher here — this is a content-strategy signal, not a quality judgement on carousels.
function contentMixScore(clipsPct: number): number {
  return clamp(clipsPct, 0, 100);
}

export interface InfluencerScoreInput {
  followersAvailable: boolean;
  followers: number | null;
  engagementRatePct: number | null;
  consistencyScore01: number | null;
  contentMixClipsPct: number | null;
}

export interface InfluencerScoreResult {
  buzzFactor: number;
  components: {
    reach: number | null;
    engagement: number | null;
    consistency: number | null;
    contentMix: number | null;
  };
}

export function scoreInfluencer(
  input: InfluencerScoreInput,
  weights: InfluencerWeights = DEFAULT_WEIGHTS,
): InfluencerScoreResult {
  const reach =
    input.followersAvailable && input.followers !== null ? reachScore(input.followers) : null;
  const engagement = input.engagementRatePct !== null ? engagementScore(input.engagementRatePct) : null;
  const consistency = input.consistencyScore01 !== null ? consistencyScore(input.consistencyScore01) : null;
  const contentMix = input.contentMixClipsPct !== null ? contentMixScore(input.contentMixClipsPct) : null;

  const parts: Array<[number | null, number]> = [
    [reach, weights.reach],
    [engagement, weights.engagement],
    [consistency, weights.consistency],
    [contentMix, weights.contentMix],
  ];
  const activeWeight = parts.reduce((sum, [v, w]) => sum + (v !== null ? w : 0), 0);
  const weightedSum = parts.reduce((sum, [v, w]) => sum + (v !== null ? v * w : 0), 0);

  // No measurable signal at all (private/unreachable account, zero posts analyzed) —
  // 0 with every component null, not a silently-omitted account.
  const buzzFactor = activeWeight > 0 ? Math.round(weightedSum / activeWeight) : 0;

  return {
    buzzFactor,
    components: {
      reach: reach !== null ? Math.round(reach) : null,
      engagement: engagement !== null ? Math.round(engagement) : null,
      consistency: consistency !== null ? Math.round(consistency) : null,
      contentMix: contentMix !== null ? Math.round(contentMix) : null,
    },
  };
}

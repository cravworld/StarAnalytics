// Composite campaign "buzz score" — one 0-100 number combining conversation size, sentiment,
// and momentum, so a campaign's health reads in one glance instead of five separate numbers.
// Same conversation-size + sentiment + nature model as UTA/Rentrak's PreAct film-buzz scores.
//
// Pure function over data getCampaignDetail already computes (campaigns.ts) — no DB calls, no
// new queries, no new cost. Not a versioned/audited score like scoring/scorePost.ts (nobody
// disputes a buzz score the way an agency disputes an authenticity score), so weights/
// thresholds are named constants here rather than a ThresholdConfig row.
//
// First-guess weights/thresholds, not a calibrated model — there's only a handful of real
// campaigns in this data today to tune against. Expect to adjust SIZE_REFERENCE_MAX and the
// weights once there's more campaign history to check them against.

const SIZE_REFERENCE_MAX = 200; // post count mapped to ~100 on the size sub-score
const MOMENTUM_EPS = 0.5; // guards the momentum ratio's divide-by-zero without distorting it
const WEIGHTS = { size: 0.4, sentiment: 0.4, momentum: 0.2 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Log-scaled, not linear — campaigns range from a handful of posts to 175+ in this data, and a
// linear scale would either cap small-but-real campaigns at ~0 or blow past 100 too easily for
// a genuinely large one.
function sizeScore(postCount: number): number {
  if (postCount <= 0) return 0;
  return clamp((100 * Math.log10(postCount + 1)) / Math.log10(SIZE_REFERENCE_MAX + 1), 0, 100);
}

// all-positive -> 100, all-negative -> 0, even split -> 50.
function sentimentScore(positivePct: number, negativePct: number): number {
  return clamp(50 + (positivePct - negativePct) / 2, 0, 100);
}

// Second half of the hourly-volume window vs the first half — a campaign accelerating scores
// higher than one flat or fading, even at identical total volume. Ratio (not difference) so a
// small campaign going 2->4 posts/hr counts the same as a large one going 20->40.
function momentumScore(hourlyVolume: number[]): number {
  if (hourlyVolume.length < 2) return 50;
  const mid = Math.floor(hourlyVolume.length / 2);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const firstAvg = avg(hourlyVolume.slice(0, mid));
  const secondAvg = avg(hourlyVolume.slice(mid));
  const ratio = (secondAvg + MOMENTUM_EPS) / (firstAvg + MOMENTUM_EPS);
  return clamp(50 + 25 * Math.log2(ratio), 0, 100);
}

export interface BuzzScoreInput {
  postCount: number;
  hourlyVolume: number[];
  // null when no posts have been sentiment-classified yet — matches CampaignSentiment's own
  // null-until-classified contract in campaigns.ts.
  sentiment: { positivePct: number; negativePct: number } | null;
}

export interface BuzzScoreResult {
  score: number;
  components: { size: number; sentiment: number | null; momentum: number };
}

export function computeBuzzScore(input: BuzzScoreInput): BuzzScoreResult {
  const size = sizeScore(input.postCount);
  const momentum = momentumScore(input.hourlyVolume);
  const sentiment = input.sentiment ? sentimentScore(input.sentiment.positivePct, input.sentiment.negativePct) : null;

  // Same "exclude and renormalize rather than fake a neutral value" discipline as
  // scorePost.ts's effScore handling — an unclassified campaign's buzz score shouldn't quietly
  // assume "50% positive" just because sentiment isn't in yet.
  const activeWeight = WEIGHTS.size + WEIGHTS.momentum + (sentiment !== null ? WEIGHTS.sentiment : 0);
  const weightedSum = size * WEIGHTS.size + momentum * WEIGHTS.momentum + (sentiment !== null ? sentiment * WEIGHTS.sentiment : 0);

  return {
    score: Math.round(weightedSum / activeWeight),
    components: {
      size: Math.round(size),
      sentiment: sentiment !== null ? Math.round(sentiment) : null,
      momentum: Math.round(momentum),
    },
  };
}

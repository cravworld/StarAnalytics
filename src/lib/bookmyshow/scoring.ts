// Theater campaign-priority scoring.
//
// Deliberately a transparent additive rule set with named constants, not a model. Same
// reasoning as src/lib/scoring/buzzScore.ts: this number decides where a distributor
// spends real money in specific towns, so every point must be traceable to a stated
// reason a human can disagree with. Each rule contributes a bounded amount and appends a
// sentence; the UI renders those sentences next to the score.
//
// What this CANNOT use, and why it matters: there is no occupancy, no seat count, and no
// tickets-sold figure available from BookMyShow (BOOKMYSHOW-FEASIBILITY.md §3). The whole
// score is built on an ordinal demand label and how it moves. Any future contributor
// tempted to add a "% full" term should read that document first — the data does not
// exist.

import {
  countsTowardDemandSignal,
  demandRank,
  type DemandConfidence,
  type DemandLevel,
} from "./demand";

/** Points for the share of a theater's shows still sitting at the most-available level. */
const WIDE_OPEN_SHARE_POINTS = 40;
/** Points when shows are wide open AND the screening is imminent — the urgent case. */
const IMMINENT_WIDE_OPEN_POINTS = 30;
/** Points when demand has not moved at all across the observation window. */
const NO_MOVEMENT_POINTS = 20;
/** Points when a theater has several weak shows rather than one unlucky slot. */
const REPEAT_WEAKNESS_POINTS = 10;
/** Multiplier applied when most readings rest on inferred (not confirmed) statuses. */
const LOW_CONFIDENCE_MULTIPLIER = 0.7;
/** "Imminent" threshold, in hours. Matches the brief's 24-hour rule. */
const IMMINENT_HOURS = 24;
/** Minimum snapshots before movement can be judged at all. */
const MIN_SNAPSHOTS_FOR_MOVEMENT = 2;

export interface ShowSignal {
  screeningId: string;
  showDateTime: Date;
  latestLevel: DemandLevel;
  latestConfidence: DemandConfidence;
  /** Earliest observation in the window, for movement. Null when only one snapshot exists. */
  firstLevel: DemandLevel | null;
  snapshotCount: number;
}

export interface TheaterPriority {
  score: number;
  band: "high" | "medium" | "low" | "not_ranked";
  reasons: string[];
  confidence: DemandConfidence;
  /** Shows that could contribute a demand signal (excludes unavailable/unknown). */
  eligibleShows: number;
  wideOpenShows: number;
  imminentWideOpenShows: number;
  /** Net ordinal movement across the window. Positive = seats became less available. */
  movement: number | null;
  recommendation: string;
}

export interface ScoringOptions {
  now: Date;
  /** Campaign's minimum sample before a theater may be called underperforming. */
  minShowsForAlert: number;
  /** Campaign's wide-open share (0-100) at which a theater is flagged. */
  wideOpenAlertPct: number;
}

/**
 * Score one theater from its shows.
 *
 * Returns `not_ranked` rather than a low score when the sample is too small. That is the
 * brief's "minimum sample count" rule and it matters in Kerala specifically: a lot of the
 * footprint is one- and two-screen venues where a single wide-open show is noise. A
 * not_ranked theater is shown as "not enough data", never as "performing fine" — absence
 * of evidence is not evidence of health.
 */
export function scoreTheater(shows: ShowSignal[], opts: ScoringOptions): TheaterPriority {
  const eligible = shows.filter((s) => countsTowardDemandSignal(s.latestLevel));
  const reasons: string[] = [];

  if (eligible.length < opts.minShowsForAlert) {
    return {
      score: 0,
      band: "not_ranked",
      reasons: [
        `Only ${eligible.length} show${eligible.length === 1 ? "" : "s"} with a usable demand reading — below the minimum of ${opts.minShowsForAlert} needed to judge this theater.`,
      ],
      confidence: aggregateConfidence(eligible),
      eligibleShows: eligible.length,
      wideOpenShows: eligible.filter((s) => s.latestLevel === "wide_open").length,
      imminentWideOpenShows: 0,
      movement: null,
      recommendation: "Not enough data to recommend action.",
    };
  }

  const wideOpen = eligible.filter((s) => s.latestLevel === "wide_open");
  const wideOpenShare = wideOpen.length / eligible.length;

  let score = 0;

  // Rule 1 — how much of the theater's slate is still wide open.
  const sharePoints = Math.round(wideOpenShare * WIDE_OPEN_SHARE_POINTS);
  if (sharePoints > 0) {
    score += sharePoints;
    reasons.push(
      `${wideOpen.length} of ${eligible.length} shows (${Math.round(wideOpenShare * 100)}%) are still wide open.`,
    );
  }

  // Rule 2 — imminence. A wide-open show tomorrow is a problem; one next week is not yet.
  const imminentWideOpen = wideOpen.filter((s) => hoursUntil(s.showDateTime, opts.now) <= IMMINENT_HOURS);
  if (imminentWideOpen.length > 0) {
    score += IMMINENT_WIDE_OPEN_POINTS;
    reasons.push(
      `${imminentWideOpen.length} wide-open show${imminentWideOpen.length === 1 ? "" : "s"} screening within ${IMMINENT_HOURS} hours.`,
    );
  }

  // Rule 3 — movement. Judged only where we have enough snapshots to have a view.
  const movement = computeMovement(eligible);
  if (movement !== null && movement <= 0) {
    score += NO_MOVEMENT_POINTS;
    reasons.push("Demand has not moved since this theater was first observed.");
  } else if (movement !== null && movement > 0) {
    reasons.push(`Demand is moving — ${movement} level step${movement === 1 ? "" : "s"} toward full since first observed.`);
  }

  // Rule 4 — repeat weakness beats one unlucky slot.
  if (wideOpen.length >= opts.minShowsForAlert && wideOpenShare * 100 >= opts.wideOpenAlertPct) {
    score += REPEAT_WEAKNESS_POINTS;
    reasons.push(
      `Weakness is across the slate, not one slot — at or above the ${opts.wideOpenAlertPct}% wide-open threshold set for this campaign.`,
    );
  }

  // Rule 5 — confidence discount. Applied last, to the total, so it visibly damps a score
  // built on inferred statuses rather than quietly altering individual rules.
  const confidence = aggregateConfidence(eligible);
  if (confidence === "low") {
    score = Math.round(score * LOW_CONFIDENCE_MULTIPLIER);
    reasons.push("Score reduced: most readings rest on BookMyShow states whose meaning is not yet confirmed.");
  }

  return {
    score,
    band: bandFor(score),
    reasons,
    confidence,
    eligibleShows: eligible.length,
    wideOpenShows: wideOpen.length,
    imminentWideOpenShows: imminentWideOpen.length,
    movement,
    recommendation: recommendationFor(bandFor(score)),
  };
}

export function hoursUntil(when: Date, now: Date): number {
  return (when.getTime() - now.getTime()) / 3_600_000;
}

/**
 * Net movement across the window, in ordinal steps toward "full".
 *
 * Only shows with at least two snapshots and a ranked level at both ends contribute —
 * `unavailable` has no defensible rank (it may be a sell-out or a cancellation), so
 * including it would let cancelled shows read as surging demand. Returns null when
 * nothing qualifies, which the caller must treat as "unknown", not "no movement".
 */
export function computeMovement(shows: ShowSignal[]): number | null {
  let total = 0;
  let counted = 0;
  for (const s of shows) {
    if (s.snapshotCount < MIN_SNAPSHOTS_FOR_MOVEMENT || s.firstLevel === null) continue;
    const first = demandRank(s.firstLevel);
    const latest = demandRank(s.latestLevel);
    if (first === null || latest === null) continue;
    total += first - latest;
    counted++;
  }
  return counted === 0 ? null : total;
}

/**
 * Confidence for the theater as a whole: high only when the majority of readings come
 * from BookMyShow states whose meaning is corroborated by a source-supplied label.
 */
export function aggregateConfidence(shows: ShowSignal[]): DemandConfidence {
  if (shows.length === 0) return "none";
  const high = shows.filter((s) => s.latestConfidence === "high").length;
  return high * 2 >= shows.length ? "high" : "low";
}

export function bandFor(score: number): TheaterPriority["band"] {
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function recommendationFor(band: TheaterPriority["band"]): string {
  switch (band) {
    case "high":
      return "Increase campaign activity here.";
    case "medium":
      return "Worth watching — consider additional activity.";
    case "not_ranked":
      return "Not enough data to recommend action.";
    default:
      return "No additional activity indicated.";
  }
}

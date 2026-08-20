// Mapping from BookMyShow's raw per-show `availStatus` to the demand vocabulary this
// feature is allowed to use.
//
// READ THIS BEFORE ADDING A LEVEL. BookMyShow publishes no seat counts on any page we are
// permitted to read (see BOOKMYSHOW-FEASIBILITY.md §3), so there is no denominator and
// therefore no occupancy percentage, ever. What the source gives is an ordinal hint about
// how much of the room is still sellable. Everything downstream — scoring, UI copy,
// alerts — is built on that and must never imply a seat count or a ticket sale.
//
// Evidence, from the 2026-08-20 spike against the live Kochi/Kerala pages:
//
//   availStatus 3 -> green pill,  no text label            CONFIRMED
//   availStatus 2 -> orange pill, analytics "fast_filling"  CONFIRMED
//   availStatus 1 -> orange pill, no text label             INFERRED
//   availStatus 0 -> not rendered as a pill in our sample   INFERRED
//
// Only 3 and 2 are corroborated by a source-supplied label. For 1 we know only that
// BookMyShow distinguishes it from 2, not that it is tighter than 2 — that ordering is
// read off the shared pill colour. For 0 we know nothing beyond "not offered": sold out,
// blocked, held, cancelled and past-cutoff would all plausibly land here.
//
// That asymmetry is why `confidence` exists and why it is carried on every snapshot
// rather than being decided once at read time.

/**
 * Normalized demand level.
 *
 * Deliberately named for what the source reports (how available the show still is), not
 * for what sold. `UNAVAILABLE` is the load-bearing one: it means "BookMyShow is not
 * offering seats for this show", which is NOT the same as "this show sold out" and must
 * never be presented as such.
 */
export type DemandLevel =
  | "wide_open"
  | "filling"
  | "limited"
  | "unavailable"
  | "unknown";

export type DemandConfidence = "high" | "low" | "none";

export interface DemandReading {
  level: DemandLevel;
  confidence: DemandConfidence;
  /** True when the source value is one we have never seen before — surfaced, not swallowed. */
  unmapped: boolean;
}

/**
 * Ordinal rank used for comparisons and trend deltas. Higher = more seats still on sale.
 *
 * `unavailable` and `unknown` are deliberately absent: neither has a defensible position
 * on a "how available is this" scale. `unavailable` might be a sell-out (rank 0) or a
 * cancelled show (not on the scale at all), and treating it as 0 would let cancellations
 * masquerade as roaring demand. Callers must handle `null` explicitly.
 */
export function demandRank(level: DemandLevel): number | null {
  switch (level) {
    case "wide_open":
      return 3;
    case "filling":
      return 2;
    case "limited":
      return 1;
    default:
      return null;
  }
}

/**
 * Human-facing label. Kept here so the wording rules from the feasibility doc live in one
 * place and cannot drift per-component into "occupancy" or "sold".
 */
export function demandLabel(level: DemandLevel): string {
  switch (level) {
    case "wide_open":
      return "Wide open";
    case "filling":
      return "Filling";
    case "limited":
      return "Limited";
    case "unavailable":
      return "Not on sale";
    default:
      return "Unknown";
  }
}

/**
 * Longer explanation for tooltips and the developer panel. These strings are the honest
 * account of what we actually know, and are what keeps a reader from over-reading a
 * colour.
 */
export function demandExplanation(level: DemandLevel): string {
  switch (level) {
    case "wide_open":
      return "BookMyShow reports plenty of seats still on sale.";
    case "filling":
      return "BookMyShow labels this show as filling fast.";
    case "limited":
      return "BookMyShow reports a more constrained state than 'filling'. Exact meaning unconfirmed.";
    case "unavailable":
      return "BookMyShow is not offering seats for this show. Could be sold out, blocked, cancelled, or past its booking cutoff — the source does not distinguish these.";
    default:
      return "No availability state was reported for this show.";
  }
}

/**
 * The mapping itself.
 *
 * A status outside the known set returns `unknown` with `unmapped: true` rather than
 * throwing or guessing. A BookMyShow change that introduces a 5th state should show up as
 * a visible count of unmapped readings — not as a failed scan, and emphatically not as a
 * silently-wrong demand figure that moves campaign spend.
 */
export function readDemand(availStatus: number | null | undefined): DemandReading {
  switch (availStatus) {
    case 3:
      return { level: "wide_open", confidence: "high", unmapped: false };
    case 2:
      return { level: "filling", confidence: "high", unmapped: false };
    case 1:
      // Distinct from 2 in the source; its position on the scale is inferred from the
      // shared pill colour alone. Low confidence until the 48h delta test shows shows
      // transitioning 2 -> 1 and never 1 -> 2.
      return { level: "limited", confidence: "low", unmapped: false };
    case 0:
      return { level: "unavailable", confidence: "low", unmapped: false };
    case null:
    case undefined:
      return { level: "unknown", confidence: "none", unmapped: false };
    default:
      return { level: "unknown", confidence: "none", unmapped: true };
  }
}

/**
 * Whether a reading should count toward "this theater needs a campaign push".
 *
 * Excludes `unavailable` (the brief's "do not prioritize cancelled or sold-out shows" —
 * and since we cannot tell those apart, neither may drive a recommendation) and `unknown`
 * (absence of data is not evidence of weak demand — the single most important rule in
 * this feature).
 */
export function countsTowardDemandSignal(level: DemandLevel): boolean {
  return level === "wide_open" || level === "filling" || level === "limited";
}

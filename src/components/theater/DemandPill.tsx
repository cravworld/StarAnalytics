import { Pill } from "@/components/ui/Pill";
import { demandExplanation, demandLabel, type DemandLevel } from "@/lib/bookmyshow/demand";

/**
 * The demand label, in the app's pill vocabulary.
 *
 * Colour choice is deliberate and inverted from what you might expect: `wide_open` is the
 * WARNING state here, not the good one. This screen answers "where is nobody booking", so
 * a show with plenty of seats left is the problem and a full one is fine. Getting this
 * backwards would make the whole table read as its own opposite.
 *
 * `title` carries the honest caveat for the two levels whose meaning is inferred, so a
 * reader hovering a "Not on sale" chip learns it might be a cancellation rather than a
 * sell-out.
 */
export function DemandPill({ level }: { level: DemandLevel }) {
  const kind =
    level === "wide_open" ? "warn" : level === "filling" ? "good" : level === "limited" ? "good" : "default";

  return (
    <span title={demandExplanation(level)}>
      <Pill kind={kind}>{demandLabel(level)}</Pill>
    </span>
  );
}

/**
 * Confidence indicator.
 *
 * Shown next to every score rather than buried in a detail panel: roughly a third of the
 * demand vocabulary rests on states whose meaning is not yet confirmed against live data,
 * and a reader deciding where to spend money is entitled to see that on the same row as
 * the recommendation.
 */
export function ConfidencePill({ confidence }: { confidence: "high" | "low" | "none" }) {
  if (confidence === "none") {
    return (
      <span title="No usable availability readings for this theater.">
        <Pill>No data</Pill>
      </span>
    );
  }
  if (confidence === "high") {
    return (
      <span title="Most readings come from BookMyShow states whose meaning is corroborated by a source label.">
        <Pill kind="good">High</Pill>
      </span>
    );
  }
  return (
    <span title="Most readings rest on BookMyShow states whose exact meaning is inferred, not confirmed. Treat the ranking as indicative.">
      <Pill kind="warn">Low</Pill>
    </span>
  );
}

export function PriorityPill({ band }: { band: "high" | "medium" | "low" | "not_ranked" }) {
  switch (band) {
    case "high":
      return <Pill kind="bad">Push here</Pill>;
    case "medium":
      return <Pill kind="warn">Watch</Pill>;
    case "not_ranked":
      return (
        <span title="Too few usable readings to judge this theater. Not the same as performing well.">
          <Pill>Not enough data</Pill>
        </span>
      );
    default:
      return <Pill kind="good">Healthy</Pill>;
  }
}

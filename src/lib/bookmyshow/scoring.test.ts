import { describe, expect, it } from "vitest";
import { aggregateConfidence, computeMovement, scoreTheater, type ShowSignal } from "./scoring";
import type { DemandLevel } from "./demand";

const NOW = new Date("2026-08-21T06:00:00.000Z");
const OPTS = { now: NOW, minShowsForAlert: 3, wideOpenAlertPct: 80 };

function show(over: Partial<ShowSignal> = {}): ShowSignal {
  return {
    screeningId: Math.random().toString(36).slice(2),
    // ~14 hours out by default: inside the 24h imminence window.
    showDateTime: new Date(NOW.getTime() + 14 * 3_600_000),
    latestLevel: "wide_open",
    latestConfidence: "high",
    firstLevel: "wide_open",
    snapshotCount: 3,
    ...over,
  };
}

function shows(n: number, over: Partial<ShowSignal> = {}) {
  return Array.from({ length: n }, () => show(over));
}

describe("scoreTheater — sample size gate", () => {
  it("refuses to rank a theater below the campaign's minimum sample", () => {
    // Kerala's footprint is full of one- and two-screen venues; a single wide-open show
    // there is noise, not a campaign signal.
    const result = scoreTheater(shows(2), OPTS);
    expect(result.band).toBe("not_ranked");
    expect(result.score).toBe(0);
    expect(result.reasons[0]).toMatch(/below the minimum/i);
  });

  it("says 'not enough data', never 'performing fine'", () => {
    const result = scoreTheater(shows(1), OPTS);
    expect(result.recommendation).toMatch(/not enough data/i);
    expect(result.recommendation).not.toMatch(/no additional activity/i);
  });

  it("does not count not-on-sale or unknown shows toward the sample", () => {
    const result = scoreTheater(
      [...shows(2), show({ latestLevel: "unavailable" }), show({ latestLevel: "unknown" })],
      OPTS,
    );
    expect(result.eligibleShows).toBe(2);
    expect(result.band).toBe("not_ranked");
  });
});

describe("scoreTheater — the underperforming theater", () => {
  const result = scoreTheater(shows(4), OPTS);

  it("scores high when the whole slate is wide open and imminent", () => {
    expect(result.band).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it("explains every contribution in plain language", () => {
    expect(result.reasons.join(" ")).toMatch(/4 of 4 shows \(100%\) are still wide open/);
    expect(result.reasons.join(" ")).toMatch(/within 24 hours/);
    expect(result.reasons.join(" ")).toMatch(/has not moved/);
    expect(result.recommendation).toMatch(/increase campaign activity/i);
  });

  it("never phrases a reason in terms of sales or occupancy", () => {
    expect(result.reasons.join(" ")).not.toMatch(/\b(sold|occupanc|tickets)\b/i);
  });
});

describe("scoreTheater — the healthy theater", () => {
  it("scores low when demand is moving and nothing is wide open", () => {
    const result = scoreTheater(
      shows(4, { latestLevel: "filling", firstLevel: "wide_open" }),
      OPTS,
    );
    expect(result.band).toBe("low");
    expect(result.reasons.join(" ")).toMatch(/demand is moving/i);
    expect(result.recommendation).toMatch(/no additional activity/i);
  });

  it("gives no imminence points to a wide-open show that is still days away", () => {
    const far = shows(4, { showDateTime: new Date(NOW.getTime() + 96 * 3_600_000) });
    const near = shows(4);
    expect(scoreTheater(far, OPTS).score).toBeLessThan(scoreTheater(near, OPTS).score);
    expect(scoreTheater(far, OPTS).imminentWideOpenShows).toBe(0);
  });
});

describe("scoreTheater — confidence discount", () => {
  it("damps a score built mostly on inferred BookMyShow states", () => {
    // A realistic mixed slate: one confirmed wide-open show plus three shows sitting on
    // availStatus 1, whose meaning is inferred. The score is real but should be discounted
    // because most of what it rests on is not corroborated by a source label.
    const mixed = (conf: "high" | "low") => [
      show({ latestLevel: "wide_open", latestConfidence: "high" }),
      ...shows(3, { latestLevel: "limited", latestConfidence: conf }),
    ];

    const confident = scoreTheater(mixed("high"), OPTS);
    const inferred = scoreTheater(mixed("low"), OPTS);

    expect(confident.score).toBeGreaterThan(0);
    expect(inferred.score).toBeLessThan(confident.score);
    expect(confident.confidence).toBe("high");
    expect(inferred.confidence).toBe("low");
    expect(inferred.reasons.join(" ")).toMatch(/not yet confirmed/i);
  });
});

describe("computeMovement", () => {
  it("reports positive movement when shows became less available", () => {
    expect(computeMovement(shows(2, { firstLevel: "wide_open", latestLevel: "filling" }))).toBe(2);
  });

  it("reports zero when nothing changed", () => {
    expect(computeMovement(shows(3))).toBe(0);
  });

  it("returns null — not zero — when there is only one snapshot", () => {
    // "We have not observed this long enough to say" must be distinguishable from "we
    // observed it and it did not move", because the second earns priority points.
    expect(computeMovement(shows(3, { snapshotCount: 1, firstLevel: null }))).toBeNull();
  });

  it("ignores shows that went not-on-sale, so a cancellation cannot look like demand", () => {
    const movement = computeMovement([
      ...shows(1, { firstLevel: "wide_open", latestLevel: "unavailable" }),
      ...shows(1, { firstLevel: "wide_open", latestLevel: "wide_open" }),
    ]);
    expect(movement).toBe(0);
  });

  it("awards no-movement points only when movement is actually known", () => {
    const unknownMovement = scoreTheater(shows(4, { snapshotCount: 1, firstLevel: null }), OPTS);
    const knownStatic = scoreTheater(shows(4), OPTS);
    expect(unknownMovement.movement).toBeNull();
    expect(unknownMovement.score).toBeLessThan(knownStatic.score);
    expect(unknownMovement.reasons.join(" ")).not.toMatch(/has not moved/i);
  });
});

describe("aggregateConfidence", () => {
  it("is high only when a majority of readings are confirmed states", () => {
    expect(aggregateConfidence(shows(4, { latestConfidence: "high" }))).toBe("high");
    expect(aggregateConfidence(shows(4, { latestConfidence: "low" }))).toBe("low");
    expect(
      aggregateConfidence([...shows(2, { latestConfidence: "high" }), ...shows(2, { latestConfidence: "low" })]),
    ).toBe("high");
    expect(
      aggregateConfidence([...shows(1, { latestConfidence: "high" }), ...shows(3, { latestConfidence: "low" })]),
    ).toBe("low");
  });

  it("is none for an empty slate", () => {
    expect(aggregateConfidence([])).toBe("none");
  });
});

describe("no occupancy anywhere", () => {
  it("exposes no percentage-full style metric on the result", () => {
    // Guard against a future contributor reintroducing the metric the source cannot
    // support. See BOOKMYSHOW-FEASIBILITY.md §3.
    const result = scoreTheater(shows(4), OPTS);
    const keys = Object.keys(result).join(",");
    expect(keys).not.toMatch(/occupanc|seats|sold|tickets/i);
  });

  it("treats every level as ordinal, with no seat arithmetic", () => {
    const levels: DemandLevel[] = ["wide_open", "filling", "limited"];
    for (const level of levels) {
      const r = scoreTheater(shows(3, { latestLevel: level }), OPTS);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });
});

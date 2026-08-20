import { describe, expect, it } from "vitest";
import {
  countsTowardDemandSignal,
  demandLabel,
  demandRank,
  readDemand,
} from "./demand";

describe("readDemand", () => {
  it("maps the two confirmed BookMyShow states at high confidence", () => {
    expect(readDemand(3)).toEqual({ level: "wide_open", confidence: "high", unmapped: false });
    expect(readDemand(2)).toEqual({ level: "filling", confidence: "high", unmapped: false });
  });

  it("maps the two inferred states at low confidence", () => {
    // 1 and 0 have no source-supplied label corroborating their meaning — see the
    // feasibility doc. They must never be reported as confidently as 2 and 3.
    expect(readDemand(1)).toEqual({ level: "limited", confidence: "low", unmapped: false });
    expect(readDemand(0)).toEqual({ level: "unavailable", confidence: "low", unmapped: false });
  });

  it("treats a missing status as unknown, never as zero demand", () => {
    expect(readDemand(null).level).toBe("unknown");
    expect(readDemand(undefined).level).toBe("unknown");
    expect(readDemand(null).confidence).toBe("none");
  });

  it("flags an unrecognised status instead of guessing at it", () => {
    // The schema-change case: BookMyShow adds a 5th state. It must surface as visibly
    // unmapped rather than being silently bucketed into an existing level.
    const reading = readDemand(7);
    expect(reading.level).toBe("unknown");
    expect(reading.unmapped).toBe(true);
  });
});

describe("demandRank", () => {
  it("orders the three ranked levels by how available the show still is", () => {
    expect(demandRank("wide_open")).toBe(3);
    expect(demandRank("filling")).toBe(2);
    expect(demandRank("limited")).toBe(1);
  });

  it("refuses to place unavailable or unknown on the scale", () => {
    // Ranking `unavailable` as 0 would let a CANCELLED show read as a sell-out, i.e. as
    // maximum demand. Callers must handle null rather than get a plausible wrong number.
    expect(demandRank("unavailable")).toBeNull();
    expect(demandRank("unknown")).toBeNull();
  });
});

describe("countsTowardDemandSignal", () => {
  it("excludes unavailable and unknown from campaign signals", () => {
    expect(countsTowardDemandSignal("wide_open")).toBe(true);
    expect(countsTowardDemandSignal("filling")).toBe(true);
    expect(countsTowardDemandSignal("limited")).toBe(true);
    expect(countsTowardDemandSignal("unavailable")).toBe(false);
    expect(countsTowardDemandSignal("unknown")).toBe(false);
  });
});

describe("wording discipline", () => {
  it("never describes a demand level as sold, booked, or occupied", () => {
    // The feature is contractually not allowed to imply ticket sales (see the feasibility
    // doc). This guards the user-facing strings against drift.
    const forbidden = /\b(sold|booked|occupanc|tickets sold|seats sold)\b/i;
    for (const level of ["wide_open", "filling", "limited", "unavailable", "unknown"] as const) {
      expect(demandLabel(level)).not.toMatch(forbidden);
    }
  });
});

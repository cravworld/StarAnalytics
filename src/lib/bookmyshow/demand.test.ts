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

describe("reading the pill when availStatus is absent", () => {
  // Live BookMyShow stopped sending availStatus. Every one of the 165 shows in the first
  // real capture (2026-08-20) carried a styleId, and some an analytics label, and nothing
  // else. These are the three combinations that capture actually produced.

  it("recovers the same three states the availStatus table describes", () => {
    expect(readDemand(null, { styleId: "green-pill-with-border", sourceLabel: null })).toEqual({
      level: "wide_open",
      confidence: "high",
      unmapped: false,
    });
    expect(
      readDemand(null, { styleId: "orange-pill-with-border", sourceLabel: "fast_filling" }),
    ).toEqual({ level: "filling", confidence: "high", unmapped: false });
    expect(readDemand(null, { styleId: "orange-pill-with-border", sourceLabel: null })).toEqual({
      level: "limited",
      confidence: "low",
      unmapped: false,
    });
  });

  it("keeps confidence tied to whether BookMyShow supplied the word itself", () => {
    // An orange pill only earns "high" when the source says fast_filling. Without the
    // label its position on the scale is read off a shared colour — exactly the inference
    // availStatus 1 was marked low-confidence for.
    const labelled = readDemand(null, {
      styleId: "orange-pill-with-border",
      sourceLabel: "fast_filling",
    });
    const bare = readDemand(null, { styleId: "orange-pill-with-border", sourceLabel: null });
    expect(labelled.confidence).toBe("high");
    expect(bare.confidence).toBe("low");
  });

  it("keeps availStatus authoritative wherever the source still sends it", () => {
    // Mock fixtures carry availStatus. If the pill ever won, every test here would still
    // pass while the live path silently changed meaning.
    expect(
      readDemand(3, { styleId: "orange-pill-with-border", sourceLabel: "fast_filling" }).level,
    ).toBe("wide_open");
    expect(readDemand(0, { styleId: "green-pill-with-border", sourceLabel: null }).level).toBe(
      "unavailable",
    );
  });

  it("is LOUD when neither channel says anything usable", () => {
    // The regression this exists for. readDemand(null) used to return unmapped:false,
    // treating a missing field as an ordinary absence — so when BookMyShow dropped
    // availStatus entirely, 165 real shows landed with no demand signal and the scan
    // reported zero problems. The alert built for "they renumbered it" never fired for
    // "they stopped sending it". Absence must be as loud as a value we do not recognise.
    for (const pill of [
      undefined,
      {},
      { styleId: null, sourceLabel: null },
      { styleId: "purple-pill-with-border", sourceLabel: null },
    ]) {
      const reading = readDemand(null, pill);
      expect(reading.level).toBe("unknown");
      expect(reading.unmapped, `${JSON.stringify(pill)} was swallowed silently`).toBe(true);
    }
  });

  it("tolerates cosmetic renaming of the pill without widening what it accepts", () => {
    expect(readDemand(null, { styleId: "GREEN-PILL", sourceLabel: null }).level).toBe("wide_open");
    // An unrecognised colour is still unmapped rather than guessed at.
    expect(readDemand(null, { styleId: "pill-green", sourceLabel: null }).unmapped).toBe(true);
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

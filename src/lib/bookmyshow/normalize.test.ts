import { describe, expect, it } from "vitest";
import fixture from "./fixtures/showtimes.fixture.json";
import { istDateOnly, normalizeCityPage, parseShowInstant, readPriceBands, readSourceLabel } from "./normalize";
import type { BmsScrapeItem } from "./types";

const items = fixture as unknown as BmsScrapeItem[];
const byCity = (code: string) => items.find((i) => i.cityCode === code)!;

describe("normalizeCityPage — happy path", () => {
  const result = normalizeCityPage(byCity("KOCH"));

  it("extracts theaters with their stable venue codes", () => {
    expect(result.status).toBe("ok");
    expect(result.theaters.map((t) => t.venueCode).sort()).toEqual(["PVMF", "SNYK"]);
    expect(result.theaters.find((t) => t.venueCode === "PVMF")).toMatchObject({
      name: "PVR: Forum Mall, Kochi",
      chainCode: "PVR",
      cityCode: "KOCH",
      cityName: "Kochi",
    });
  });

  it("extracts one screening per show with its BookMyShow session id", () => {
    expect(result.screenings).toHaveLength(6);
    expect(result.screenings.map((s) => s.bmsSessionId)).toContain("42393");
  });

  it("keeps the raw availStatus rather than only a derived label", () => {
    const s = result.screenings.find((x) => x.bmsSessionId === "42393")!;
    expect(s.availStatus).toBe(2);
    expect(s.styleId).toBe("orange-pill-with-border");
    expect(s.sourceLabel).toBe("fast_filling");
  });

  it("records a show with no availStatus as null, not as zero", () => {
    // This is the "do not treat missing data as no demand" rule at the row level.
    const s = result.screenings.find((x) => x.bmsSessionId === "42396")!;
    expect(s.availStatus).toBeNull();
  });

  it("splits the acronym slot into language vs format", () => {
    const eng = result.screenings.find((x) => x.bmsSessionId === "42393")!;
    expect(eng.language).toBe("ENG");
    expect(eng.format).toBeNull();

    const luxe = result.screenings.find((x) => x.bmsSessionId === "42394")!;
    expect(luxe.format).toBe("LUXE");
    expect(luxe.language).toBeNull();
  });

  it("keeps price bands and drops time-band tags", () => {
    const s = result.screenings.find((x) => x.bmsSessionId === "42393")!;
    expect(s.priceBands).toEqual(["pf3", "pf4"]);
  });

  it("skips a venue with no code and says why", () => {
    expect(result.skipped).toContainEqual({ reason: "missing_venue_code" });
  });
});

describe("normalizeCityPage — malformed and changed data", () => {
  const result = normalizeCityPage(byCity("KOLM"));

  it("keeps the rows it can and skips the rest with reasons", () => {
    expect(result.status).toBe("ok");
    expect(result.screenings.map((s) => s.bmsSessionId).sort()).toEqual(["71001", "71002", "71005"]);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      "missing_session_id",
      "unparseable_show_time",
    ]);
  });

  it("preserves an unrecognised availStatus verbatim for later diagnosis", () => {
    // A schema change must not be silently coerced. Storing 7 as-is is what makes it
    // possible to notice BookMyShow changed something.
    const s = result.screenings.find((x) => x.bmsSessionId === "71005")!;
    expect(s.availStatus).toBe(7);
  });

  it("keeps a not-on-sale show rather than dropping it", () => {
    // availStatus 0 rows must survive normalization — excluding them happens later, at
    // scoring time, where the reason can be stated.
    const s = result.screenings.find((x) => x.bmsSessionId === "71001")!;
    expect(s.availStatus).toBe(0);
  });

  it("assigns a past-midnight show to the correct IST calendar day", () => {
    // 01:00 IST on the 22nd is 19:30 UTC on the 21st. Filed under the 21st it would land
    // in the wrong day's report.
    const s = result.screenings.find((x) => x.bmsSessionId === "71005")!;
    expect(s.showDate.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(s.showDateTime.toISOString()).toBe("2026-08-21T19:30:00.000Z");
  });
});

describe("normalizeCityPage — failure modes are distinguishable", () => {
  it("reports a page error as an error, with no screenings", () => {
    const result = normalizeCityPage(byCity("THSR"));
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/timed out/i);
    expect(result.screenings).toHaveLength(0);
  });

  it("rejects a page served for the wrong region instead of importing it", () => {
    // The single most dangerous failure this feature has: BookMyShow resolves region from
    // a cookie, so a Kottayam URL can return Kochi data. Importing it would attribute
    // Kochi's demand to Kottayam and move campaign money to the wrong district.
    const result = normalizeCityPage(byCity("KTYM"));
    expect(result.status).toBe("region_mismatch");
    expect(result.returnedCityCode).toBe("KOCH");
    expect(result.screenings).toHaveLength(0);
    expect(result.theaters).toHaveLength(0);
  });

  it("treats a missing query key as a mismatch rather than a pass", () => {
    const result = normalizeCityPage({ cityCode: "KOCH", showDateCode: "20260821", venues: [] });
    expect(result.status).toBe("region_mismatch");
  });
});

describe("parseShowInstant", () => {
  it("uses an ISO timestamp only when it carries an explicit offset", () => {
    const withOffset = parseShowInstant(
      { additionalData: { showDateTime: "2026-08-21T19:30:00+05:30" } },
      "20260821",
    );
    expect(withOffset!.showDateTime.toISOString()).toBe("2026-08-21T14:00:00.000Z");
  });

  it("ignores a bare local timestamp and falls back to the IST composition", () => {
    // A bare "2026-08-21 19:30" parsed by Date() is treated as UTC and lands 5.5 hours
    // off, which would silently corrupt "hours until screening".
    const result = parseShowInstant(
      { additionalData: { showDateTime: "2026-08-21 19:30", showTime: "07:30 PM" } },
      "20260821",
    );
    expect(result!.showDateTime.toISOString()).toBe("2026-08-21T14:00:00.000Z");
  });

  it("returns null rather than an approximate time", () => {
    expect(parseShowInstant({ additionalData: { showTime: "half past seven" } }, "20260821")).toBeNull();
    expect(parseShowInstant({ additionalData: { showTime: "07:30 PM" } }, "not-a-date")).toBeNull();
  });

  it("handles 12-hour boundaries", () => {
    expect(parseShowInstant({ additionalData: { showTime: "12:30 AM" } }, "20260821")!.showDateTime.toISOString())
      .toBe("2026-08-20T19:00:00.000Z");
    expect(parseShowInstant({ additionalData: { showTime: "12:30 PM" } }, "20260821")!.showDateTime.toISOString())
      .toBe("2026-08-21T07:00:00.000Z");
  });
});

describe("istDateOnly", () => {
  it("returns the IST calendar day as midnight UTC", () => {
    expect(istDateOnly(new Date("2026-08-21T19:30:00.000Z")).toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(istDateOnly(new Date("2026-08-21T10:00:00.000Z")).toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });
});

describe("readSourceLabel / readPriceBands", () => {
  it("survives malformed analytics metadata", () => {
    expect(readSourceLabel({ cta: { analytics: { metadata: "{not json" } } })).toBeNull();
    expect(readSourceLabel({})).toBeNull();
  });

  it("returns an empty band list when filters are absent", () => {
    expect(readPriceBands({})).toEqual([]);
  });
});

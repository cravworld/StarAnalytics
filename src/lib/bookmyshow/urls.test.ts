import { describe, expect, it } from "vitest";
import {
  assertRegionMatch,
  buildRegionCookieValue,
  buildShowtimeUrl,
  extractReturnedRegionCode,
  isValidEventCode,
  KERALA_REGIONS,
  parseEventCode,
  regionByCode,
  resolveRegions,
} from "./urls";

describe("parseEventCode — the input allowlist", () => {
  it("accepts a bare event code", () => {
    expect(parseEventCode("et00502829")).toBe("et00502829");
    expect(parseEventCode("ET00502829")).toBe("et00502829");
  });

  it("extracts the code from a genuine BookMyShow URL", () => {
    expect(
      parseEventCode(
        "https://in.bookmyshow.com/movies/koch:kochi/bethlehem-kudumba-unit-koch:kochi/buytickets/et00502829/20260821",
      ),
    ).toBe("et00502829");
  });

  it("refuses any other host", () => {
    // This is what stops the campaign form being used to aim the scraper at an arbitrary
    // site. A look-alike host must not slip through a suffix check.
    expect(parseEventCode("https://evil.test/buytickets/et00502829")).toBeNull();
    expect(parseEventCode("https://in.bookmyshow.com.evil.test/buytickets/et00502829")).toBeNull();
    expect(parseEventCode("https://notin.bookmyshow.com/buytickets/et00502829")).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    expect(parseEventCode("")).toBeNull();
    expect(parseEventCode("   ")).toBeNull();
    expect(parseEventCode("javascript:alert(1)")).toBeNull();
    expect(parseEventCode("https://in.bookmyshow.com/movies/koch:kochi")).toBeNull();
  });
});

describe("isValidEventCode", () => {
  it("requires the et + digits shape", () => {
    expect(isValidEventCode("et00502829")).toBe(true);
    expect(isValidEventCode("et123456")).toBe(true);
    expect(isValidEventCode("et123")).toBe(false);
    expect(isValidEventCode("xx00502829")).toBe(false);
    expect(isValidEventCode("et00502829; DROP TABLE")).toBe(false);
  });
});

describe("buildShowtimeUrl", () => {
  const region = regionByCode("KOCH")!;

  it("builds the canonical sitemap URL shape", () => {
    expect(buildShowtimeUrl({ region, movieSlug: "bethlehem-kudumba-unit", eventCode: "et00502829" })).toBe(
      "https://in.bookmyshow.com/movies/koch:kochi/bethlehem-kudumba-unit-koch:kochi/buytickets/et00502829",
    );
  });

  it("appends the date segment when given one", () => {
    const url = buildShowtimeUrl({
      region,
      movieSlug: "bethlehem-kudumba-unit",
      eventCode: "et00502829",
      date: new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(url.endsWith("/20260821")).toBe(true);
  });

  it("refuses to build anything from an invalid code", () => {
    expect(() =>
      buildShowtimeUrl({ region, movieSlug: "x", eventCode: "../../etc/passwd" }),
    ).toThrow(/invalid event code/i);
  });

  it("only ever produces in.bookmyshow.com URLs", () => {
    for (const r of KERALA_REGIONS) {
      const url = new URL(buildShowtimeUrl({ region: r, movieSlug: "m", eventCode: "et00502829" }));
      expect(url.hostname).toBe("in.bookmyshow.com");
      expect(url.protocol).toBe("https:");
    }
  });
});

describe("resolveRegions", () => {
  it("treats an empty city list as every Kerala region, not as none", () => {
    // Getting this backwards would turn a Kerala-wide campaign into a silent no-op.
    expect(resolveRegions([]).length).toBe(KERALA_REGIONS.length);
  });

  it("resolves explicit codes and drops unknown ones", () => {
    expect(resolveRegions(["KOCH", "PLKK"]).map((r) => r.code)).toEqual(["KOCH", "PLKK"]);
    expect(resolveRegions(["KOCH", "NOPE"]).map((r) => r.code)).toEqual(["KOCH"]);
  });

  it("covers the districts the campaign cares about", () => {
    const codes = KERALA_REGIONS.map((r) => r.code);
    for (const expected of ["KOCH", "TRIV", "THSR", "KOZH", "KOLM", "PLKK", "KTYM", "KANN", "ALPZ"]) {
      expect(codes).toContain(expected);
    }
  });

  it("has no duplicate region codes", () => {
    const codes = KERALA_REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("region guard", () => {
  it("extracts the region the payload actually describes", () => {
    expect(extractReturnedRegionCode("fetchPrimaryDynamic-ET00502829---20260820-KOCH")).toBe("KOCH");
    expect(extractReturnedRegionCode(null)).toBeNull();
  });

  it("passes only when the served region matches the requested one", () => {
    expect(assertRegionMatch("KOCH", "fetchPrimaryDynamic-ET00502829---20260820-KOCH").ok).toBe(true);
    expect(assertRegionMatch("PLKK", "fetchPrimaryDynamic-ET00502829---20260820-KOCH").ok).toBe(false);
  });

  it("fails closed when the payload identifies no region at all", () => {
    // A missing key must never be read as "probably fine" — that is how one district's
    // demand data ends up attributed to another.
    expect(assertRegionMatch("KOCH", null).ok).toBe(false);
    expect(assertRegionMatch("KOCH", "fetchPrimaryDynamic-nonsense").ok).toBe(false);
  });
});

describe("buildRegionCookieValue", () => {
  it("produces a decodable first-party region preference", () => {
    const value = buildRegionCookieValue(regionByCode("PLKK")!);
    const parsed = JSON.parse(decodeURIComponent(value));
    expect(parsed.regionCode).toBe("PLKK");
    expect(parsed.regionNameSlug).toBe("palakkad");
  });

  it("carries no credential, token, or user identifier", () => {
    // It is a city preference, equivalent to picking a city in the UI — nothing else may
    // ever be smuggled into it.
    const value = decodeURIComponent(buildRegionCookieValue(regionByCode("KOCH")!));
    expect(value).not.toMatch(/token|auth|session|bmsId|password|cookie/i);
  });
});

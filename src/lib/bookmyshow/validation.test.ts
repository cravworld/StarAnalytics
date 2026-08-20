import { describe, expect, it } from "vitest";
import { ALLOWED_SCAN_INTERVALS, validateCampaignInput } from "./validation";

const VALID = {
  name: "Bethlehem Kerala push",
  movieName: "Bethlehem Kudumba Unit",
  bmsUrlOrCode: "et00502829",
  targetCityCodes: ["KOCH", "PLKK"],
  screeningStartDate: "2026-08-21",
  screeningEndDate: "2026-08-28",
  scanIntervalMinutes: 90,
  wideOpenAlertPct: 80,
  minShowsForAlert: 3,
};

describe("validateCampaignInput — happy path", () => {
  it("accepts a well-formed campaign", () => {
    const result = validateCampaignInput(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bmsEventCode).toBe("et00502829");
    expect(result.value.targetCityCodes).toEqual(["KOCH", "PLKK"]);
    expect(result.value.screeningStartDate?.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("treats an empty city list as valid — it means every Kerala region", () => {
    const result = validateCampaignInput({ ...VALID, targetCityCodes: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetCityCodes).toEqual([]);
  });

  it("accepts a full BookMyShow URL and keeps it for provenance", () => {
    const url =
      "https://in.bookmyshow.com/movies/koch:kochi/bethlehem-kudumba-unit-koch:kochi/buytickets/et00502829";
    const result = validateCampaignInput({ ...VALID, bmsUrlOrCode: url });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bmsEventCode).toBe("et00502829");
    expect(result.value.bmsSourceUrl).toBe(url);
  });

  it("does not store a source URL when only a bare code was given", () => {
    const result = validateCampaignInput(VALID);
    if (result.ok) expect(result.value.bmsSourceUrl).toBeNull();
  });
});

describe("validateCampaignInput — the URL allowlist", () => {
  it("rejects a non-BookMyShow URL", () => {
    // The anti-SSRF / anti-generic-scraper boundary.
    const result = validateCampaignInput({ ...VALID, bmsUrlOrCode: "https://evil.test/buytickets/et00502829" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.bmsUrlOrCode).toMatch(/not a BookMyShow movie link/i);
  });

  it("rejects a look-alike host", () => {
    const result = validateCampaignInput({
      ...VALID,
      bmsUrlOrCode: "https://in.bookmyshow.com.evil.test/buytickets/et00502829",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects internal addresses outright", () => {
    for (const target of [
      "http://localhost:3000/admin",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
    ]) {
      expect(validateCampaignInput({ ...VALID, bmsUrlOrCode: target }).ok).toBe(false);
    }
  });

  it("requires the field at all", () => {
    const result = validateCampaignInput({ ...VALID, bmsUrlOrCode: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.bmsUrlOrCode).toBeTruthy();
  });
});

describe("validateCampaignInput — required fields", () => {
  it("requires a name and a movie name", () => {
    const result = validateCampaignInput({ ...VALID, name: "  ", movieName: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBeTruthy();
      expect(result.errors.movieName).toBeTruthy();
    }
  });

  it("bounds field lengths", () => {
    const result = validateCampaignInput({ ...VALID, name: "x".repeat(200) });
    expect(result.ok).toBe(false);
  });
});

describe("validateCampaignInput — cities", () => {
  it("rejects region codes BookMyShow does not have", () => {
    const result = validateCampaignInput({ ...VALID, targetCityCodes: ["KOCH", "ATLANTIS"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.targetCityCodes).toMatch(/ATLANTIS/);
  });

  it("normalizes case", () => {
    const result = validateCampaignInput({ ...VALID, targetCityCodes: ["koch"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetCityCodes).toEqual(["KOCH"]);
  });
});

describe("validateCampaignInput — dates and time zones", () => {
  it("stores a date input as the IST calendar day at midnight UTC", () => {
    const result = validateCampaignInput({ ...VALID, screeningStartDate: "2026-08-21" });
    if (result.ok) expect(result.value.screeningStartDate?.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("rejects a malformed date rather than coercing it", () => {
    for (const bad of ["21-08-2026", "2026/08/21", "not-a-date", "2026-13-01"]) {
      const result = validateCampaignInput({ ...VALID, screeningStartDate: bad });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an end date before the start date", () => {
    const result = validateCampaignInput({
      ...VALID,
      screeningStartDate: "2026-08-28",
      screeningEndDate: "2026-08-21",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.screeningEndDate).toMatch(/cannot be before/i);
  });

  it("allows an open-ended window", () => {
    const result = validateCampaignInput({ ...VALID, screeningStartDate: "", screeningEndDate: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.screeningStartDate).toBeNull();
  });
});

describe("validateCampaignInput — scan interval", () => {
  it("accepts only allowlisted intervals", () => {
    for (const interval of ALLOWED_SCAN_INTERVALS) {
      expect(validateCampaignInput({ ...VALID, scanIntervalMinutes: interval }).ok).toBe(true);
    }
  });

  it("refuses an aggressive interval", () => {
    // This scans a third party's site; a 1-minute interval is not a configuration choice
    // we should make available.
    for (const bad of [1, 5, 0, -30, 7]) {
      expect(validateCampaignInput({ ...VALID, scanIntervalMinutes: bad }).ok).toBe(false);
    }
  });
});

describe("validateCampaignInput — thresholds", () => {
  it("bounds the wide-open percentage", () => {
    for (const bad of [0, 101, -5, 12.5]) {
      expect(validateCampaignInput({ ...VALID, wideOpenAlertPct: bad }).ok).toBe(false);
    }
    expect(validateCampaignInput({ ...VALID, wideOpenAlertPct: 100 }).ok).toBe(true);
  });

  it("bounds the minimum sample size", () => {
    for (const bad of [0, -1, 51, 2.5]) {
      expect(validateCampaignInput({ ...VALID, minShowsForAlert: bad }).ok).toBe(false);
    }
    expect(validateCampaignInput({ ...VALID, minShowsForAlert: 1 }).ok).toBe(true);
  });

  it("rejects non-numeric threshold input instead of defaulting it", () => {
    expect(validateCampaignInput({ ...VALID, wideOpenAlertPct: "eighty" }).ok).toBe(false);
  });
});

describe("validateCampaignInput — hostile input", () => {
  it("does not throw on wrong types", () => {
    expect(() =>
      validateCampaignInput({
        name: { toString: () => "x" },
        movieName: 42,
        bmsUrlOrCode: ["et00502829"],
        targetCityCodes: "KOCH",
        scanIntervalMinutes: {},
      }),
    ).not.toThrow();
  });

  it("reports every problem at once rather than one at a time", () => {
    const result = validateCampaignInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).length).toBeGreaterThan(2);
  });
});

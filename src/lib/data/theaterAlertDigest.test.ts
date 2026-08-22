import { describe, expect, it } from "vitest";
import {
  BMS_BASIS_NOTE,
  citySummary,
  digestSubject,
  formatCampaignAlertDigest,
  formatCampaignAlertDigestHtml,
  sortTheatersByUrgency,
  wideOpenPct,
  type TheaterAlertSummary,
} from "./theaterAlertDigest";

/**
 * The digest exists because a scan used to send one email per flagged theater — 32 emails
 * from one run, heading for ~178 at full Kerala coverage. These tests pin the properties
 * that make a single summary readable enough to replace them.
 */

const AT = new Date("2026-08-22T09:00:00Z");

function theater(over: Partial<TheaterAlertSummary> = {}): TheaterAlertSummary {
  return {
    theaterId: "t1",
    name: "Aries Plex",
    cityName: "Trivandrum",
    wideOpenShows: 6,
    eligibleShows: 12,
    confidence: "high",
    reasons: ["Half the shows are wide open."],
    ...over,
  };
}

function digest(theaters: TheaterAlertSummary[]) {
  return { movieName: "Empuraan", theaters, generatedAt: AT };
}

describe("wideOpenPct", () => {
  it("is the share of eligible shows still wide open", () => {
    expect(wideOpenPct({ wideOpenShows: 6, eligibleShows: 12 })).toBe(50);
    expect(wideOpenPct({ wideOpenShows: 9, eligibleShows: 10 })).toBe(90);
  });

  it("never divides by zero when a theater has no eligible shows", () => {
    // scoreTheater excludes unavailable/unknown shows, so eligibleShows can legitimately
    // be 0. That must read as 0%, not NaN — NaN would render as "NaN%" in the email.
    expect(wideOpenPct({ wideOpenShows: 0, eligibleShows: 0 })).toBe(0);
  });
});

describe("sortTheatersByUrgency", () => {
  it("puts the worst theater first", () => {
    const rows = sortTheatersByUrgency([
      theater({ theaterId: "a", name: "A", wideOpenShows: 2, eligibleShows: 10 }), // 20%
      theater({ theaterId: "b", name: "B", wideOpenShows: 9, eligibleShows: 10 }), // 90%
      theater({ theaterId: "c", name: "C", wideOpenShows: 5, eligibleShows: 10 }), // 50%
    ]);
    expect(rows.map((r) => r.theaterId)).toEqual(["b", "c", "a"]);
  });

  it("breaks a percentage tie on the bigger absolute number of open shows", () => {
    // Both 50%, but one is 10 open shows and the other is 1 — the ten-show theater is the
    // bigger opportunity and should be read first.
    const rows = sortTheatersByUrgency([
      theater({ theaterId: "small", name: "S", wideOpenShows: 1, eligibleShows: 2 }),
      theater({ theaterId: "big", name: "B", wideOpenShows: 10, eligibleShows: 20 }),
    ]);
    expect(rows[0].theaterId).toBe("big");
  });

  it("does not mutate the array it was given", () => {
    const input = [
      theater({ theaterId: "a", wideOpenShows: 1, eligibleShows: 10 }),
      theater({ theaterId: "b", wideOpenShows: 9, eligibleShows: 10 }),
    ];
    sortTheatersByUrgency(input);
    expect(input.map((r) => r.theaterId)).toEqual(["a", "b"]);
  });
});

describe("citySummary", () => {
  it("lists each city once, worst first", () => {
    const cities = citySummary([
      theater({ theaterId: "a", cityName: "Kochi", wideOpenShows: 3, eligibleShows: 10 }),
      theater({ theaterId: "b", cityName: "Trivandrum", wideOpenShows: 9, eligibleShows: 10 }),
      theater({ theaterId: "c", cityName: "Kochi", wideOpenShows: 8, eligibleShows: 10 }),
    ]);
    expect(cities).toEqual(["Trivandrum", "Kochi"]);
  });
});

describe("digestSubject", () => {
  it("says how many theaters need a push, so the inbox line alone is useful", () => {
    expect(digestSubject(digest([theater(), theater({ theaterId: "t2" })]))).toBe(
      "Empuraan: 2 theatres need a push",
    );
  });

  it("reads correctly for a single theater", () => {
    expect(digestSubject(digest([theater()]))).toBe("Empuraan: 1 theatre needs a push");
  });
});

describe("formatCampaignAlertDigest (text)", () => {
  it("covers every theater in one message", () => {
    const text = formatCampaignAlertDigest(
      digest([
        theater({ theaterId: "a", name: "Aries Plex", cityName: "Trivandrum" }),
        theater({ theaterId: "b", name: "Lulu PVR", cityName: "Kochi" }),
        theater({ theaterId: "c", name: "Carnival", cityName: "Palakkad" }),
      ]),
    );
    expect(text).toContain("Aries Plex");
    expect(text).toContain("Lulu PVR");
    expect(text).toContain("Carnival");
    expect(text).toContain("3 theatres");
  });

  it("carries the availability-vs-sales basis note exactly once", () => {
    // Load-bearing: the recipient is being asked to spend money on the strength of an
    // availability label. Once, in the footer — repeating it per row is what the old
    // per-theater emails did and is why it stopped being read.
    const text = formatCampaignAlertDigest(digest([theater({ theaterId: "a" }), theater({ theaterId: "b" })]));
    expect(text.split(BMS_BASIS_NOTE)).toHaveLength(2);
  });

  it("leads with the worst theater", () => {
    const text = formatCampaignAlertDigest(
      digest([
        theater({ theaterId: "a", name: "Mild", wideOpenShows: 2, eligibleShows: 10 }),
        theater({ theaterId: "b", name: "Severe", wideOpenShows: 9, eligibleShows: 10 }),
      ]),
    );
    expect(text.indexOf("Severe")).toBeLessThan(text.indexOf("Mild"));
  });
});

describe("formatCampaignAlertDigestHtml", () => {
  it("renders one row per theater", () => {
    const html = formatCampaignAlertDigestHtml(
      digest([
        theater({ theaterId: "a", name: "Aries Plex" }),
        theater({ theaterId: "b", name: "Lulu PVR" }),
      ]),
    );
    expect(html).toContain("Aries Plex");
    expect(html).toContain("Lulu PVR");
    expect(html).toContain("Empuraan");
  });

  it("escapes theater names rather than interpolating them raw", () => {
    // Theater names come from a scraped third-party page, so they are untrusted input
    // being pasted into an HTML document.
    const html = formatCampaignAlertDigestHtml(digest([theater({ name: 'A<script>"&x' })]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("A&lt;script&gt;&quot;&amp;x");
  });

  it("gives a low-but-nonzero reading a visible bar", () => {
    // A 3% row must still render as a mark. A literal 3% width is invisible in most mail
    // clients, which would show a real signal as an empty row.
    const html = formatCampaignAlertDigestHtml(digest([theater({ wideOpenShows: 3, eligibleShows: 100 })]));
    expect(html).toContain("width:3%");
  });

  it("uses only inline styles and tables, never flex or grid", () => {
    // Outlook renders neither, and there is no stylesheet in an email.
    const html = formatCampaignAlertDigestHtml(digest([theater()]));
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toContain("<style");
  });

  it("carries the basis note exactly once", () => {
    const html = formatCampaignAlertDigestHtml(digest([theater({ theaterId: "a" }), theater({ theaterId: "b" })]));
    expect(html.split(BMS_BASIS_NOTE)).toHaveLength(2);
  });
});

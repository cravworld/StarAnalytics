import { describe, expect, it } from "vitest";
import { formatCount, formatHoursUntil, formatIstDate, formatIstDateTime } from "./format";

// These exist because of React hydration error #418 on the campaign detail page.
//
// `toLocaleString(undefined, …)` reads the locale AND time zone from whichever runtime it
// runs in. Server-side that is the Vercel function (UTC); during hydration it is the
// visitor's browser (IST). Same instant, different text, so React tears down and re-renders
// — and for five and a half hours' worth of showtimes, the SSR output is simply wrong.

describe("formatIstDateTime", () => {
  const INSTANT = new Date("2026-08-21T18:29:00.000Z"); // 23:59 IST on the 21st

  it("renders in IST regardless of the machine's own time zone", () => {
    // The actual bug: a show at 23:59 IST on the 21st is 18:29 UTC, still the 21st — but a
    // show at 20:00 IST on the 21st is 14:30 UTC the same day, while 00:30 IST on the 22nd
    // is 19:00 UTC on the 21st. A UTC-rendered evening slate shows the wrong DAY.
    const lateNight = new Date("2026-08-21T19:00:00.000Z"); // 00:30 IST on the 22nd
    expect(formatIstDateTime(lateNight)).toContain("22");
    expect(formatIstDateTime(INSTANT)).toContain("21");
  });

  it("is stable across repeated calls, which is what hydration compares", () => {
    expect(formatIstDateTime(INSTANT)).toBe(formatIstDateTime(INSTANT));
  });

  it("accepts the shapes the data layer actually hands it", () => {
    const fromString = formatIstDateTime(INSTANT.toISOString());
    const fromNumber = formatIstDateTime(INSTANT.getTime());
    const fromDate = formatIstDateTime(INSTANT);
    expect(fromString).toBe(fromDate);
    expect(fromNumber).toBe(fromDate);
  });
});

// The same bug, found again in production on the post tracker (#418 on
// /campaigns/tracker/[campaignId]). PR #52 shipped its own inline
// `toLocaleDateString("en-IN", …)` calls, which name the locale but not the zone — so the
// numbers grouped correctly and the DAY was still whatever zone the runtime was in.
describe("formatIstDate", () => {
  it("renders the IST day, not the UTC one, for a post published after midnight IST", () => {
    // 02:00 IST on the 22nd is 20:30 UTC on the 21st. The server said "21 Aug", the browser
    // said "22 Aug", and React tore the tree down. Every post published between midnight
    // and 05:30 IST hits this — an ordinary night's posting, not an edge case.
    const afterMidnightIst = new Date("2026-08-21T20:30:00.000Z");
    expect(formatIstDate(afterMidnightIst)).toContain("22");
  });

  it("adds the year only when asked", () => {
    const d = new Date("2026-08-21T06:00:00.000Z");
    expect(formatIstDate(d)).not.toContain("2026");
    expect(formatIstDate(d, { year: true })).toContain("2026");
  });

  it("is stable across repeated calls, which is what hydration compares", () => {
    const d = new Date("2026-08-21T20:30:00.000Z");
    expect(formatIstDate(d)).toBe(formatIstDate(d));
  });

  it("accepts the shapes the data layer actually hands it", () => {
    const d = new Date("2026-08-21T06:00:00.000Z");
    expect(formatIstDate(d.toISOString())).toBe(formatIstDate(d));
    expect(formatIstDate(d.getTime())).toBe(formatIstDate(d));
  });
});

describe("formatCount", () => {
  // Bare toLocaleString() groups by the runtime's locale: a Vercel function says
  // "1,234,567" and an en-IN browser says "12,34,567". Same text mismatch, same #418.
  it("groups the Indian way regardless of the runtime's own locale", () => {
    expect(formatCount(1234567)).toBe("12,34,567");
  });

  it("leaves small numbers alone", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });
});

describe("formatHoursUntil", () => {
  const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();
  const at = (h: number) => new Date(NOW + h * 3_600_000);

  it("takes now as an argument so both render passes agree", () => {
    // Read from Date.now() inside the component, the SSR pass and hydration land
    // milliseconds apart. Near a boundary that is the difference between "1h" and "<1h" —
    // a mismatch that appears only sometimes, which is the worst kind to chase.
    const boundary = at(1.0001);
    expect(formatHoursUntil(boundary, NOW)).toBe(formatHoursUntil(boundary, NOW));
  });

  it("labels the ranges the table relies on", () => {
    expect(formatHoursUntil(at(-1), NOW)).toBe("started");
    expect(formatHoursUntil(at(0.5), NOW)).toBe("<1h");
    expect(formatHoursUntil(at(3), NOW)).toBe("3h");
    expect(formatHoursUntil(at(72), NOW)).toBe("3d");
  });

  it("returns a dash rather than inventing a time for a show with no slot", () => {
    expect(formatHoursUntil(null, NOW)).toBe("–");
    expect(formatHoursUntil(undefined, NOW)).toBe("–");
  });
});

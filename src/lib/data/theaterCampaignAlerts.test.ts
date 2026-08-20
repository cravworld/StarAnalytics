import { describe, expect, it } from "vitest";
import { alertDedupMinutes } from "./theaterCampaigns";

// The dedup window decides how often the same "this theater is quiet" line reaches a human.
// It is worth a test because it was wrong in a way that only showed up in production: the
// window was the campaign's scanIntervalMinutes, which was right while the Vercel cron was
// the only caller, and wrong the moment collection moved to the local capture task running
// three times a day at five-hour intervals.

describe("alert dedup window", () => {
  const CAPTURE_GAP_MINUTES = 5 * 60; // 09:00, 14:00, 19:00

  it("outlasts the gap between captures", () => {
    // The actual bug. A 90-minute campaign interval is shorter than the five hours between
    // captures, so every run fell outside the window and re-alerted every flagged theater:
    // 32 theaters × 3 runs ≈ 96 notifications a day, heading for ~530 at full coverage.
    expect(alertDedupMinutes(90)).toBeGreaterThan(CAPTURE_GAP_MINUTES);
  });

  it("keeps a quiet theater to at most a couple of mentions a day", () => {
    const perDay = (24 * 60) / alertDedupMinutes(90);
    expect(perDay).toBeLessThanOrEqual(2);
  });

  it("never shortens a campaign that already asks for less frequent alerts", () => {
    // The interval is a floor, not a replacement. A campaign scanned daily should not start
    // alerting twice a day because the floor is 12 hours.
    expect(alertDedupMinutes(1440)).toBe(1440);
    expect(alertDedupMinutes(3000)).toBe(3000);
  });

  it("is a floor for short intervals, whatever they are", () => {
    for (const interval of [1, 15, 90, 240]) {
      expect(alertDedupMinutes(interval)).toBeGreaterThanOrEqual(720);
    }
  });
});

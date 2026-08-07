import { describe, it, expect } from "vitest";
import { formatAge } from "./format";

const NOW = new Date("2026-08-07T06:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms);
const MIN = 60_000;
const HOUR = 3_600_000;

describe("formatAge", () => {
  it("collapses sub-minute ages", () => {
    expect(formatAge(ago(30_000), NOW)).toBe("just now");
  });

  it("singularises correctly at each boundary", () => {
    expect(formatAge(ago(MIN), NOW)).toBe("1 minute ago");
    expect(formatAge(ago(2 * MIN), NOW)).toBe("2 minutes ago");
    expect(formatAge(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(formatAge(ago(24 * HOUR), NOW)).toBe("1 day ago");
  });

  it("rolls up to hours and days rather than reporting large minute counts", () => {
    expect(formatAge(ago(90 * MIN), NOW)).toBe("1 hour ago");
    expect(formatAge(ago(23 * HOUR), NOW)).toBe("23 hours ago");
    // The age the banner actually rendered on 2026-08-07.
    expect(formatAge(new Date("2026-07-31T14:05:46Z"), NOW)).toBe("6 days ago");
  });
});

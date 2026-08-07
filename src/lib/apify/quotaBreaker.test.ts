import { describe, it, expect } from "vitest";
import {
  isApifyQuotaError,
  isQuotaCircuitOpen,
  ApifyQuotaExhaustedError,
  QUOTA_ERROR_MARKER,
} from "./quotaBreaker";

// Verbatim from prod (scrape_runs.error, 2026-08-07) — not a paraphrase, since the
// whole matcher is a substring check against exactly this payload.
const REAL_QUOTA_ERROR = `Apify runActor(apify/instagram-hashtag-scraper) failed: 403 {
  "error": {
    "type": "platform-feature-disabled",
    "message": "Monthly usage hard limit exceeded"
  }
}`;

const HOUR = 3_600_000;
const COOLDOWN = 55 * 60 * 1000;

describe("isApifyQuotaError", () => {
  it("matches the real Apify quota rejection", () => {
    expect(isApifyQuotaError(REAL_QUOTA_ERROR)).toBe(true);
  });

  it("ignores other Apify failures", () => {
    expect(isApifyQuotaError("Apify run yPK3Quu9bFwjYJH9c did not finish within 300000ms")).toBe(false);
    expect(isApifyQuotaError("Apify runActor(apify/instagram-post-scraper) failed: 429 rate limited")).toBe(false);
  });

  it("ignores null and undefined", () => {
    expect(isApifyQuotaError(null)).toBe(false);
    expect(isApifyQuotaError(undefined)).toBe(false);
  });

  // The feedback loop this guards against: runAgencyBatchJob writes any caught error onto
  // its own agency_batch scrape_runs row. If the breaker's own message matched, every skip
  // would move lastQuotaErrorAt forward and the circuit could never re-probe.
  it("does not match the breaker's own skip message", () => {
    const skip = new ApifyQuotaExhaustedError("apify/instagram-hashtag-scraper");
    expect(isApifyQuotaError(skip.message)).toBe(false);
    expect(skip.message).not.toContain(QUOTA_ERROR_MARKER);
  });
});

describe("isQuotaCircuitOpen", () => {
  const now = new Date("2026-08-07T06:00:00Z").getTime();

  it("stays closed when no quota rejection has been recorded", () => {
    expect(
      isQuotaCircuitOpen({ lastQuotaErrorAt: null, lastSuccessAt: new Date(now - HOUR), now, cooldownMs: COOLDOWN }),
    ).toBe(false);
  });

  it("opens on a recent quota rejection", () => {
    expect(
      isQuotaCircuitOpen({
        lastQuotaErrorAt: new Date(now - 10 * 60_000),
        lastSuccessAt: null,
        now,
        cooldownMs: COOLDOWN,
      }),
    ).toBe(true);
  });

  it("allows a probe once the cooldown has elapsed", () => {
    expect(
      isQuotaCircuitOpen({
        lastQuotaErrorAt: new Date(now - 56 * 60_000),
        lastSuccessAt: null,
        now,
        cooldownMs: COOLDOWN,
      }),
    ).toBe(false);
  });

  // The point of the 55-minute default: poll-hashtags runs at `0 * * * *`, so a rejection
  // at 05:00 must not still be blocking the 06:00 tick. A 60-minute cooldown would halve
  // the probe rate for no benefit.
  it("lets the next hourly tick probe after a rejection on the previous one", () => {
    const rejectedLastTick = new Date(now - HOUR + 1_000); // 05:00:01, tick is 06:00:00
    expect(
      isQuotaCircuitOpen({ lastQuotaErrorAt: rejectedLastTick, lastSuccessAt: null, now, cooldownMs: COOLDOWN }),
    ).toBe(false);
  });

  // Recovery must not wait out the cooldown: this is what makes raising the Apify cap
  // take effect on the very next tick.
  it("closes immediately when a run succeeded after the last rejection", () => {
    expect(
      isQuotaCircuitOpen({
        lastQuotaErrorAt: new Date(now - 10 * 60_000),
        lastSuccessAt: new Date(now - 5 * 60_000),
        now,
        cooldownMs: COOLDOWN,
      }),
    ).toBe(false);
  });

  it("stays open when the only success predates the rejection", () => {
    expect(
      isQuotaCircuitOpen({
        lastQuotaErrorAt: new Date(now - 10 * 60_000),
        lastSuccessAt: new Date(now - 7 * 24 * HOUR),
        now,
        cooldownMs: COOLDOWN,
      }),
    ).toBe(true);
  });
});

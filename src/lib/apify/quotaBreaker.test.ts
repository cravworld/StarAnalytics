import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isApifyQuotaError,
  isApifyQuotaFailure,
  isAccountBudgetExhausted,
  isQuotaCircuitOpen,
  resetAccountBudgetCache,
  ApifyQuotaExhaustedError,
  BUDGET_RESERVE_USD,
  QUOTA_ERROR_MARKER,
} from "./quotaBreaker";
import { readAccountUsage } from "@/lib/apify/client";

vi.mock("@/lib/apify/client", () => ({ readAccountUsage: vi.fn() }));
const mockUsage = vi.mocked(readAccountUsage);

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

describe("isApifyQuotaFailure", () => {
  // Every loop that scrapes more than one thing asks this before trying the next one, and
  // the answer arrives in two different shapes depending on whether the breaker skipped
  // pre-emptively or Apify actually rejected the call.
  it("matches both the pre-emptive skip and a real Apify rejection", () => {
    expect(isApifyQuotaFailure(new ApifyQuotaExhaustedError("apify/instagram-post-scraper"))).toBe(true);
    expect(isApifyQuotaFailure(new Error(REAL_QUOTA_ERROR))).toBe(true);
  });

  // The mid-run case: Apify aborts a run that was legal when it started, reporting a plain
  // ABORTED with no quota marker of its own. trackedRun stamps the marker on after checking
  // the account, and this is what has to recognise the result.
  it("matches the mid-run abort message trackedRun composes", () => {
    expect(
      isApifyQuotaFailure(
        new Error(`Apify run ended with status ABORTED — account budget exhausted (${QUOTA_ERROR_MARKER})`),
      ),
    ).toBe(true);
  });

  it("does not match ordinary failures or non-errors", () => {
    expect(isApifyQuotaFailure(new Error("Apify run abc did not finish within 180000ms — aborted"))).toBe(false);
    expect(isApifyQuotaFailure("some string")).toBe(false);
    expect(isApifyQuotaFailure(null)).toBe(false);
  });
});

describe("isAccountBudgetExhausted", () => {
  beforeEach(() => {
    resetAccountBudgetCache();
    mockUsage.mockReset();
  });

  it("reports exhausted once headroom drops to the reserve", async () => {
    mockUsage.mockResolvedValue({ monthlyUsageUsd: 29 - BUDGET_RESERVE_USD, maxMonthlyUsageUsd: 29 });
    expect(await isAccountBudgetExhausted()).toBe(true);
  });

  // The state the account was actually in when this was written: over the cap, not merely at it.
  it("reports exhausted when already over the cap", async () => {
    mockUsage.mockResolvedValue({ monthlyUsageUsd: 29.24, maxMonthlyUsageUsd: 29 });
    expect(await isAccountBudgetExhausted()).toBe(true);
  });

  it("reports available with real headroom left", async () => {
    mockUsage.mockResolvedValue({ monthlyUsageUsd: 4, maxMonthlyUsageUsd: 29 });
    expect(await isAccountBudgetExhausted()).toBe(false);
  });

  // Fails open on purpose: an Apify API blip must not be able to halt ingestion by itself,
  // since the 403 breaker still covers the start-time rejection independently.
  it("treats an unreadable usage endpoint as available", async () => {
    mockUsage.mockResolvedValue(null);
    expect(await isAccountBudgetExhausted()).toBe(false);
  });

  it("caches, so a burst of runs in one tick costs one usage lookup", async () => {
    mockUsage.mockResolvedValue({ monthlyUsageUsd: 29.24, maxMonthlyUsageUsd: 29 });
    expect(await isAccountBudgetExhausted()).toBe(true);
    expect(await isAccountBudgetExhausted()).toBe(true);
    expect(mockUsage).toHaveBeenCalledTimes(1);
  });

  // A null answer must not be cached, or one blip would suppress budget checks for the
  // whole cache window.
  it("does not cache the fail-open answer", async () => {
    mockUsage.mockResolvedValue(null);
    expect(await isAccountBudgetExhausted()).toBe(false);
    expect(await isAccountBudgetExhausted()).toBe(false);
    expect(mockUsage).toHaveBeenCalledTimes(2);
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

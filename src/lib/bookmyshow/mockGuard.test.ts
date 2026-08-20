import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Guards on the one path that can write invented data into a real campaign.
//
// "Run scan now" uses whatever DATA_MODE_BOOKMYSHOW selects, and that is `mock` in every
// deployment today, because BookMyShow blocks server-side collection. On a campaign built
// from real captures, the button would therefore inject fabricated theaters and readings
// into the table someone allocates budget from — the single worst thing this feature could
// do, and the opposite of everything else it is careful about.

const SCAN = readFileSync("src/app/api/theater-campaigns/[id]/scan/route.ts", "utf8");
const CRON = readFileSync("src/app/api/cron/scan-theater-campaigns/route.ts", "utf8");
const DATA = readFileSync("src/lib/data/theaterCampaigns.ts", "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("a mock scan cannot overwrite real captured data", () => {
  it("the manual scan route checks before doing anything else", () => {
    const code = stripComments(SCAN);
    expect(code).toMatch(/mockScanBlockedReason/);
    // Before the lock is taken and before the scan starts — refusing after a run row exists
    // would leave debris to explain.
    const guardAt = code.indexOf("mockScanBlockedReason");
    const scanAt = code.indexOf("runCampaignScan(id)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(scanAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(scanAt);
  });

  it("the unattended cron checks too", () => {
    // Unattended is where this matters most: nobody would notice a nightly tick diluting
    // real measurements with fixtures.
    expect(stripComments(CRON)).toMatch(/mockScanBlockedReason/);
  });

  it("only blocks when the campaign actually holds real data", () => {
    // Mock has to stay fully usable on a fresh campaign — that is what makes the feature
    // demoable with no Apify account at all. The rule is about MIXING, not about mock.
    const guard = DATA.slice(DATA.indexOf("export async function mockScanBlockedReason"));
    expect(guard).toMatch(/provider: \{ not: "mock" \}/);
    expect(guard).toMatch(/if \(!realRun\) return null/);
  });

  it("does not block when a live provider is configured", () => {
    // The guard is about fixtures, not about server-side scanning as such. If live
    // collection ever becomes possible, this must not be what stands in the way.
    const guard = DATA.slice(DATA.indexOf("export async function mockScanBlockedReason"));
    expect(guard).toMatch(/if \(isBookMyShowLive\(\)\) return null/);
  });

  it("explains itself in terms the person clicking can act on", () => {
    const guard = DATA.slice(DATA.indexOf("export async function mockScanBlockedReason"));
    expect(guard).toMatch(/local capture/i);
    expect(guard).not.toMatch(/DATA_MODE_BOOKMYSHOW is not set/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Guards on the local-capture path.
//
// The capture script is the one part of this feature that touches BookMyShow directly, and
// it is defensible ONLY because of what it refuses to do. That refusal is a design
// commitment, not a coding-style preference, so it is asserted here rather than left to a
// comment nobody re-reads.

const SCRIPT = readFileSync("scripts/bms-capture.mjs", "utf8");
const INGEST = readFileSync("src/app/api/theater-campaigns/[id]/ingest/route.ts", "utf8");
const PLAN = readFileSync("src/app/api/theater-campaigns/[id]/capture-plan/route.ts", "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the capture script does not disguise itself", () => {
  const code = stripComments(SCRIPT);

  it("uses no stealth or fingerprint-patching library", () => {
    // If this ever fails, the change being made is the one that turns a defensible
    // collection method into circumvention. Do not "fix" the test.
    for (const banned of [
      "puppeteer-extra",
      "playwright-extra",
      "stealth",
      "rebrowser",
      "undetected",
      "fingerprint",
      "patchright",
    ]) {
      expect(code.toLowerCase(), `capture script references ${banned}`).not.toContain(banned);
    }
  });

  it("does not override the user agent or navigator properties", () => {
    expect(code).not.toMatch(/userAgent\s*:/);
    expect(code).not.toMatch(/navigator\.webdriver/);
    expect(code).not.toMatch(/addInitScript/);
  });

  it("uses no proxy of any kind", () => {
    expect(code).not.toMatch(/proxy/i);
  });

  it("drives the real installed Chrome, not bundled Chromium", () => {
    // channel:"chrome" is the whole basis of the approach — it is a genuine browser, so
    // nothing has to pretend.
    expect(code).toMatch(/channel:\s*["']chrome["']/);
  });

  it("paces itself between page loads", () => {
    expect(code).toMatch(/sleep\(DELAY_MS\)/);
  });

  it("stops rather than retrying when everything is blocked", () => {
    // A retry-until-through loop is how a legitimate tool becomes an attack. When every
    // page fails, the script exits and says so.
    expect(code).toMatch(/if \(ok === 0\)/);
    expect(SCRIPT).toMatch(/stop and reassess rather than retrying/i);
  });

  it("checks the daily budget before opening a browser, not after", () => {
    // Discovering the cap at ingest means the pages were already fetched from BookMyShow
    // and the run is then thrown away with a 429 — requests spent, nothing learned. The
    // check has to come before chromium.launch.
    const budgetAt = code.indexOf("capturesRemaining");
    const launchAt = code.indexOf("chromium.launch");
    expect(budgetAt, "capture script never reads capturesRemaining").toBeGreaterThan(-1);
    expect(launchAt).toBeGreaterThan(-1);
    expect(budgetAt, "budget check runs after the browser is opened").toBeLessThan(launchAt);
  });

  it("does not request pages it already knows will be refused", () => {
    // Measured twice on 2026-08-20: page one of a run succeeds, every page after it 403s.
    // With a fixed city order that means a scheduled sweep captures Kochi three times a day
    // and never sees the other 29 regions — while sending 29 requests already known to be
    // refused. The window rotates so a different city gets the one slot that works.
    //
    // This is not evasion and must not become it: the yield stays one city per run. If a
    // change here starts trying to get MORE pages out of a session, that is the line.
    expect(code).toMatch(/rotateWindow/);
    expect(code).toMatch(/MAX_CITIES/);
    expect(SCRIPT).toMatch(/does NOT try to get more pages than BookMyShow is willing to serve/i);
  });

  it("still honours an explicit --cities list verbatim", () => {
    // Rotation is a default for unattended sweeps. Someone who names cities means those.
    expect(code).toMatch(/if \(raw\) return known;/);
  });

  it("sets the region cookie per page, because the URL alone is not honoured", () => {
    expect(code).toMatch(/clearCookies\(\{ name: "rgn" \}\)/);
    expect(code).toMatch(/regionCode: code/);
  });
});

describe("capture endpoints fail closed", () => {
  it("both refuse to operate when the shared secret is unset", () => {
    for (const [name, source] of [
      ["ingest", INGEST],
      ["capture-plan", PLAN],
    ] as const) {
      expect(source, `${name} does not fail closed`).toMatch(
        /if \(!process\.env\.BOOKMYSHOW_CAPTURE_SECRET\)/,
      );
    }
  });

  it("both compare the secret in constant time", () => {
    // These are the only campaign endpoints not behind NextAuth — a scheduled script has no
    // session — so the secret comparison is the whole boundary.
    for (const source of [INGEST, PLAN]) {
      expect(source).toMatch(/timingSafeEqual/);
    }
  });

  it("enforces a server-side daily cap that the client cannot raise", () => {
    expect(INGEST).toMatch(/BOOKMYSHOW_CAPTURE_MAX_PER_DAY/);
    expect(stripComments(INGEST)).toMatch(/capturesToday >= MAX_CAPTURES_PER_DAY/);
    expect(stripComments(INGEST)).toMatch(/status: 429/);
  });

  it("bounds the payload so one request cannot be unbounded work", () => {
    expect(stripComments(INGEST)).toMatch(/items\.length > MAX_ITEMS/);
  });

  it("stops collecting for a campaign that is paused or archived", () => {
    // Pausing in the UI has to be a real kill switch, not just a display change — the
    // scheduled task on someone's PC keeps firing regardless.
    expect(stripComments(PLAN)).toMatch(/campaign\.status !== "active"/);
    expect(stripComments(INGEST)).toMatch(/campaign\.status === "archived"/);
  });

  it("returns only what is needed to build public URLs and pace the run", () => {
    // A leaked secret should expose as little as possible. capturesRemaining is a bare
    // count with no campaign detail in it, which is why it is allowed here.
    const returned = stripComments(PLAN);
    expect(returned).toMatch(/eventCode/);
    expect(returned).toMatch(/movieSlug/);
    expect(returned).toMatch(/cityCodes/);
    expect(returned).toMatch(/capturesRemaining/);
    expect(returned).not.toMatch(/wideOpenAlertPct|minShowsForAlert|bmsSourceUrl/);
  });

  it("still enforces the cap server-side, not just in the plan", () => {
    // The plan reports the budget so the script can stop early; the ingest route is what
    // actually refuses. If enforcement ever moved to the advisory number, an edited script
    // could ignore it and the cap would be decoration.
    expect(stripComments(INGEST)).toMatch(/capturesToday >= MAX_CAPTURES_PER_DAY/);
    expect(stripComments(INGEST)).toMatch(/status: 429/);
  });
});

describe("capture ingest shares one pipeline with provider scans", () => {
  it("goes through ingestScrapeItems rather than its own write path", () => {
    // Two ingest paths that drift apart would be two different definitions of the truth —
    // and the region assertion, idempotency and disappearance rules all live in there.
    expect(INGEST).toMatch(/ingestScrapeItems/);
    expect(stripComments(INGEST)).not.toMatch(/prisma\.(screening|availabilitySnapshot|theater)\./);
  });

  it("records its own provider name so the UI can say where a number came from", () => {
    expect(stripComments(INGEST)).toMatch(/provider: "capture"/);
  });

  it("never raises alerts off a failed ingest", () => {
    expect(stripComments(INGEST)).toMatch(/result\.status !== "error"[\s\S]{0,80}raiseCampaignAlerts/);
  });
});

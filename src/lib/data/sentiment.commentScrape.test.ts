import { describe, it, expect, afterEach } from "vitest";
import { isCommentScrapeEnabled } from "./sentiment";

/**
 * The comment scrape is the only metered-Apify step in the sentiment pipeline, and it is off
 * unless explicitly switched on. That default is the whole safety property, so it is pinned
 * here rather than left to a code reading: an accidental inversion (`!== "off"`, a truthiness
 * check, a default-on constant) would silently resume paid scraping on the next deploy and
 * nothing else in the suite would notice.
 *
 * Deliberately asserts the *unset* case too — "nobody has configured this yet" is the state a
 * fresh environment is in, and it must mean off, not on.
 */
describe("isCommentScrapeEnabled", () => {
  const original = process.env.COMMENT_SCRAPE;

  afterEach(() => {
    if (original === undefined) delete process.env.COMMENT_SCRAPE;
    else process.env.COMMENT_SCRAPE = original;
  });

  it("is off when unset", () => {
    delete process.env.COMMENT_SCRAPE;
    expect(isCommentScrapeEnabled()).toBe(false);
  });

  it("is on only for the exact opt-in value", () => {
    process.env.COMMENT_SCRAPE = "on";
    expect(isCommentScrapeEnabled()).toBe(true);
  });

  it("is off for anything else, including values that look enabled", () => {
    // "true"/"1"/"yes" are the plausible near-misses. Treating them as off is intentional:
    // one exact opt-in value is easier to grep for and to reason about than a truthiness rule,
    // and the failure mode of guessing wrong is spending money, not losing a feature.
    for (const v of ["off", "false", "0", "", "true", "1", "yes", "ON", "On"]) {
      process.env.COMMENT_SCRAPE = v;
      expect(isCommentScrapeEnabled(), `COMMENT_SCRAPE=${JSON.stringify(v)} must not enable scraping`).toBe(false);
    }
  });
});

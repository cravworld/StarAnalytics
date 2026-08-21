import { describe, it, expect, vi } from "vitest";

// captionMentionsCampaign lives in trackedPosts.ts, which imports Prisma at module load.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { captionMentionsCampaign } = await import("./trackedPosts");

/**
 * This function decides whether a post discovered from a tracked page counts toward the
 * campaign's totals. It is the ONLY automatic signal, so both its failure directions matter:
 * a false positive puts an influencer's holiday photo into the client's engagement numbers,
 * and a false negative drops real campaign work out of them.
 *
 * The false negative is the survivable one, and only because non-matching posts are still
 * stored and shown as "not counted" with a one-click include. If they were filtered away at
 * ingest, this function's mistakes would be permanent and invisible.
 */
describe("captionMentionsCampaign", () => {
  const NP50 = ["np50"];
  const PLUTO = ["pluto", "neerajmadhav", "althafsalim", "ajuvarghese"];

  it("matches a campaign hashtag in the caption", () => {
    expect(captionMentionsCampaign("Great day on set #np50", NP50)).toBe(true);
  });

  it("is case-insensitive, because nobody types hashtags consistently", () => {
    expect(captionMentionsCampaign("#NP50 shoot", NP50)).toBe(true);
    expect(captionMentionsCampaign("#Np50", NP50)).toBe(true);
  });

  it("matches any one of a campaign's several hashtags", () => {
    expect(captionMentionsCampaign("with #ajuvarghese today", PLUTO)).toBe(true);
  });

  // The reason for the word boundary: #np50 must not match #np500, which would be a
  // different campaign entirely.
  it("does not match a longer hashtag that merely starts with the campaign tag", () => {
    expect(captionMentionsCampaign("#np500 crowd", NP50)).toBe(false);
    expect(captionMentionsCampaign("#np50th", NP50)).toBe(false);
  });

  it("still matches when the tag is followed by punctuation or another tag", () => {
    expect(captionMentionsCampaign("#np50, what a day", NP50)).toBe(true);
    expect(captionMentionsCampaign("#np50 #behindthescenes", NP50)).toBe(true);
    expect(captionMentionsCampaign("shoot!#np50", NP50)).toBe(true);
  });

  // A bare mention of the word is not a campaign tag — "pluto" is also a dwarf planet.
  it("requires the # — a plain word is not a hashtag", () => {
    expect(captionMentionsCampaign("watched pluto last night", PLUTO)).toBe(false);
  });

  it("handles campaign tags stored with a leading # already", () => {
    expect(captionMentionsCampaign("#np50", ["#np50"])).toBe(true);
  });

  it("is false rather than throwing when there is no caption or no hashtags", () => {
    expect(captionMentionsCampaign(null, NP50)).toBe(false);
    expect(captionMentionsCampaign("#np50", [])).toBe(false);
    expect(captionMentionsCampaign("", NP50)).toBe(false);
  });

  // Campaign hashtags are operator-entered free text and reach a RegExp constructor.
  it("does not blow up on regex metacharacters in a campaign tag", () => {
    expect(() => captionMentionsCampaign("anything", ["c++(*)"])).not.toThrow();
    expect(captionMentionsCampaign("a #c++(*) b", ["c++(*)"])).toBe(true);
  });
});

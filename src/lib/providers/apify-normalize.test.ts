import { describe, it, expect } from "vitest";
import { normalizeTrackedProfileItem, postUrlKey } from "./apify-normalize";

// These exist because an attribution miss is a *silent* 100%-waste failure: the Apify
// comment run is billed in full, every item is discarded, zero rows are stored, and the
// post then re-qualifies for another paid scrape. Exact string matching on the URL echo
// is what made that possible, so each case below is a URL shape that would have missed.
describe("postUrlKey", () => {
  const CANONICAL = "https://www.instagram.com/p/DN8-GjPkgjS/";

  it("matches the same post across URL shapes the actor might echo back", () => {
    const key = postUrlKey(CANONICAL);
    for (const variant of [
      "https://www.instagram.com/p/DN8-GjPkgjS", // no trailing slash
      "https://instagram.com/p/DN8-GjPkgjS/", // no www
      "http://www.instagram.com/p/DN8-GjPkgjS/", // http
      "https://www.instagram.com/p/DN8-GjPkgjS/?igsh=MXY2ZmZ4", // tracking param
      "https://www.instagram.com/P/DN8-GjPkgjS/", // uppercase path segment
    ]) {
      expect(postUrlKey(variant)).toBe(key);
    }
  });

  it("treats /reel/ and /reels/ as the same post", () => {
    expect(postUrlKey("https://www.instagram.com/reel/DDIJAfeyemG/")).toBe(
      postUrlKey("https://www.instagram.com/reels/DDIJAfeyemG"),
    );
  });

  // The shortcode is case-sensitive on Instagram's side — collapsing case here would
  // merge two genuinely different posts onto one key and misattribute their comments.
  it("keeps distinct posts distinct, including by shortcode case", () => {
    expect(postUrlKey(CANONICAL)).not.toBe(postUrlKey("https://www.instagram.com/p/DDIJAfeyemG/"));
    expect(postUrlKey(CANONICAL)).not.toBe(postUrlKey("https://www.instagram.com/p/dn8-gjpkgjs/"));
  });

  it("falls back to a normalized whole URL for unrecognised shapes", () => {
    expect(postUrlKey("https://example.com/Post/123/")).toBe("https://example.com/post/123");
    expect(postUrlKey("  https://example.com/x  ")).toBe("https://example.com/x");
  });
});

// The account's own words about itself, kept so a category can be SUGGESTED rather than
// guessed from a handle. Field names here are unverified against a live run (the Apify
// account is blocked for outstanding invoices), which is exactly why every one of them
// reads through a fallback list and why the empty-vs-missing distinction is tested.
describe("normalizeTrackedProfileItem", () => {
  it("reads bio and business category from the documented field names", () => {
    expect(
      normalizeTrackedProfileItem({
        followersCount: 12000,
        fullName: "Review Master",
        biography: "Movie reviews & cinema updates",
        businessCategoryName: "Digital creator",
      }),
    ).toEqual({
      followers: 12000,
      displayName: "Review Master",
      bio: "Movie reviews & cinema updates",
      platformCategory: "Digital creator",
    });
  });

  it("falls back to categoryName when businessCategoryName is absent", () => {
    expect(normalizeTrackedProfileItem({ categoryName: "Movie" }).platformCategory).toBe("Movie");
  });

  // The distinction the whole normalizer turns on. An account with an empty bio has been
  // measured; a response with no biography field at all has not — and since the field names
  // are unverified, "every account came back null" is the signal that they are wrong.
  it("keeps an empty bio distinct from a missing one", () => {
    expect(normalizeTrackedProfileItem({ biography: "" }).bio).toBe("");
    expect(normalizeTrackedProfileItem({}).bio).toBeNull();
  });

  // Nothing here may substitute a zero. A private or deleted profile returns no follower
  // count, and 0 would be a fabricated audience that every engagement rate divides by.
  it("returns nulls, never zeros, for an empty item", () => {
    expect(normalizeTrackedProfileItem({})).toEqual({
      followers: null,
      displayName: null,
      bio: null,
      platformCategory: null,
    });
  });

  it("ignores non-string junk in the text fields", () => {
    const out = normalizeTrackedProfileItem({ biography: 42, businessCategoryName: null });
    expect(out.bio).toBeNull();
    expect(out.platformCategory).toBeNull();
  });
});

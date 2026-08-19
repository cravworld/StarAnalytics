import { describe, it, expect } from "vitest";
import { postUrlKey } from "./apify-normalize";

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

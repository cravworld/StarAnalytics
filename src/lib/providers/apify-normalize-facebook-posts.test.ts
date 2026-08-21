import { describe, it, expect } from "vitest";
import { normalizeFacebookPostItem, facebookPostKeys } from "./apify-normalize-facebook-posts";

// apify-scout-normalize-facebook.ts records this repo's own finding from live runs: Facebook
// scrapes come back less consistently shaped than Instagram's. These tests pin the two
// behaviours that protects — fallbacks across field names, and null (never 0) when a metric
// simply isn't in the payload.

describe("facebookPostKeys", () => {
  // A pasted link may use the pfbid permalink while the actor reports the numeric id, or
  // the reverse. Matching on one form alone silently drops the other.
  it("collects every id form a post could be matched by", () => {
    const keys = facebookPostKeys({
      postId: "1234567890",
      url: "https://www.facebook.com/thepage/posts/pfbid0AbCdEf",
    });
    expect(keys).toContain("1234567890");
    expect(keys).toContain("pfbid0AbCdEf");
  });

  it("reads a numeric id out of the url when postId is absent", () => {
    expect(facebookPostKeys({ url: "https://www.facebook.com/thepage/posts/987654321" })).toContain("987654321");
  });

  it("handles watch and permalink shapes", () => {
    expect(facebookPostKeys({ url: "https://www.facebook.com/watch/?v=555" })).toContain("555");
    expect(facebookPostKeys({ url: "https://www.facebook.com/permalink.php?story_fbid=777&id=1" })).toContain("777");
  });

  it("de-duplicates", () => {
    const keys = facebookPostKeys({ postId: "111", url: "https://www.facebook.com/p/posts/111" });
    expect(keys.filter((k) => k === "111")).toHaveLength(1);
  });

  it("returns an empty list rather than throwing on an empty item", () => {
    expect(facebookPostKeys({})).toEqual([]);
  });
});

describe("normalizeFacebookPostItem", () => {
  const full = {
    postId: "1234567890",
    url: "https://www.facebook.com/thepage/posts/1234567890",
    pageName: "The Page",
    facebookId: "999",
    text: "Campaign post",
    time: "2026-08-19T10:00:00.000Z",
    likes: 4200,
    comments: 310,
    shares: 88,
    viewsCount: 51000,
    reactionLikeCount: 4000,
    reactionLoveCount: 180,
    reactionHahaCount: 20,
  };

  it("reads the documented field names", () => {
    const n = normalizeFacebookPostItem(full);
    expect(n.likes).toBe(4200);
    expect(n.comments).toBe(310);
    expect(n.shares).toBe(88);
    expect(n.views).toBe(51000);
    expect(n.pageName).toBe("The Page");
    expect(n.caption).toBe("Campaign post");
    expect(n.postedAt).toBe("2026-08-19T10:00:00.000Z");
  });

  it("builds the reaction breakdown, which is Facebook-only", () => {
    expect(normalizeFacebookPostItem(full).reactions).toEqual({ like: 4000, love: 180, haha: 20 });
  });

  it("falls back to alternate field names", () => {
    const n = normalizeFacebookPostItem({
      postId: "1",
      message: "alt text",
      commentsCount: 5,
      sharesCount: 2,
      videoViewCount: 100,
      user: { name: "Nested Page", id: "42" },
    });
    expect(n.caption).toBe("alt text");
    expect(n.comments).toBe(5);
    expect(n.shares).toBe(2);
    expect(n.views).toBe(100);
    expect(n.pageName).toBe("Nested Page");
    expect(n.pageId).toBe("42");
  });

  it("parses numeric strings, including comma-formatted ones", () => {
    const n = normalizeFacebookPostItem({ postId: "1", likes: "1,234", comments: "56" });
    expect(n.likes).toBe(1234);
    expect(n.comments).toBe(56);
  });

  // The rule the whole feature rests on: absent is not zero.
  it("returns null, not 0, for metrics the payload doesn't carry", () => {
    const n = normalizeFacebookPostItem({ postId: "1", likes: 10 });
    expect(n.comments).toBeNull();
    expect(n.shares).toBeNull();
    expect(n.views).toBeNull();
    expect(n.reactions).toBeNull();
  });

  // Summed reactions and the plain like count measure different things; substituting one
  // for the other would put a derived number in a column the UI presents as measured.
  it("does not synthesise `likes` from the reaction breakdown", () => {
    const n = normalizeFacebookPostItem({ postId: "1", reactionLoveCount: 50, reactionHahaCount: 10 });
    expect(n.likes).toBeNull();
    expect(n.reactions).toEqual({ love: 50, haha: 10 });
  });

  it("classifies a post with a view count as video", () => {
    expect(normalizeFacebookPostItem({ postId: "1", viewsCount: 10 }).mediaType).toBe("video");
    expect(normalizeFacebookPostItem({ postId: "1" }).mediaType).toBe("image");
  });

  it("survives a completely empty item", () => {
    const n = normalizeFacebookPostItem({});
    expect(n.likes).toBeNull();
    expect(n.postKeys).toEqual([]);
  });
});

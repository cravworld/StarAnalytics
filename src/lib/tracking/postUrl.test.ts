import { describe, it, expect } from "vitest";
import {
  parsePostUrl,
  parseAccountUrl,
  accountUrlFor,
  accountKeyFor,
  facebookPageFrom,
  FB_SHARE_LINK_REASON,
} from "./postUrl";

function parsed(url: string) {
  const r = parsePostUrl(url);
  if (!r.ok) throw new Error(`expected ${url} to parse, got: ${r.reason}`);
  return r.value;
}

describe("parsePostUrl — Instagram", () => {
  it("accepts /p/, /reel/, /reels/ and /tv/ as the same shortcode space", () => {
    expect(parsed("https://www.instagram.com/p/CxYz123_-/").postKey).toBe("CxYz123_-");
    expect(parsed("https://www.instagram.com/reel/CxYz123_-/").postKey).toBe("CxYz123_-");
    expect(parsed("https://www.instagram.com/reels/CxYz123_-/").postKey).toBe("CxYz123_-");
    expect(parsed("https://www.instagram.com/tv/CxYz123_-/").postKey).toBe("CxYz123_-");
  });

  it("accepts the /{handle}/p/{code} form the web app produces", () => {
    expect(parsed("https://www.instagram.com/someone/p/CxYz123_-/").postKey).toBe("CxYz123_-");
  });

  // The whole point of keying on the shortcode rather than the URL: these are all one post.
  it("yields one key across every spelling of the same post", () => {
    const keys = [
      "https://www.instagram.com/p/CxYz123_-/",
      "http://instagram.com/p/CxYz123_-",
      "https://m.instagram.com/reel/CxYz123_-/?igsh=MTBhc2hh",
      "instagram.com/p/CxYz123_-/?utm_source=ig_web_copy_link",
    ].map((u) => parsed(u).postKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("strips per-share tracking params from the canonical URL", () => {
    const { canonicalUrl } = parsed("https://www.instagram.com/p/CxYz123_-/?igsh=abc&utm_source=x");
    expect(canonicalUrl).not.toContain("igsh");
    expect(canonicalUrl).not.toContain("utm_source");
  });

  it("rejects a profile URL with a message that mentions stories", () => {
    const r = parsePostUrl("https://www.instagram.com/someone/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/stories expire/i);
  });
});

describe("parsePostUrl — YouTube", () => {
  it("accepts watch, youtu.be, shorts, live and embed forms", () => {
    expect(parsed("https://www.youtube.com/watch?v=dQw4w9WgXcQ").postKey).toBe("dQw4w9WgXcQ");
    expect(parsed("https://youtu.be/dQw4w9WgXcQ").postKey).toBe("dQw4w9WgXcQ");
    expect(parsed("https://www.youtube.com/shorts/dQw4w9WgXcQ").postKey).toBe("dQw4w9WgXcQ");
    expect(parsed("https://www.youtube.com/live/dQw4w9WgXcQ").postKey).toBe("dQw4w9WgXcQ");
    expect(parsed("https://www.youtube.com/embed/dQw4w9WgXcQ").postKey).toBe("dQw4w9WgXcQ");
  });

  it("keeps the video id when extra params ride along", () => {
    expect(parsed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLabc").postKey).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("reports youtube as the platform", () => {
    expect(parsed("https://youtu.be/dQw4w9WgXcQ").platform).toBe("youtube");
  });
});

describe("parsePostUrl — Facebook", () => {
  it("accepts numeric /posts/, /videos/, /reel/, watch and permalink forms", () => {
    expect(parsed("https://www.facebook.com/somepage/posts/1234567890").postKey).toBe("1234567890");
    expect(parsed("https://www.facebook.com/somepage/videos/1234567890").postKey).toBe("1234567890");
    expect(parsed("https://www.facebook.com/reel/1234567890").postKey).toBe("1234567890");
    expect(parsed("https://www.facebook.com/watch/?v=1234567890").postKey).toBe("1234567890");
    expect(parsed("https://www.facebook.com/permalink.php?story_fbid=1234567890&id=99").postKey).toBe(
      "1234567890",
    );
  });

  it("keeps a pfbid permalink whole — it is opaque but stable and resolvable", () => {
    const { postKey } = parsed("https://www.facebook.com/somepage/posts/pfbid0AbCdEf123456");
    expect(postKey).toBe("pfbid0AbCdEf123456");
  });

  // The mobile share sheet's form. It carries no post id at all, so it must fail with an
  // instruction rather than a generic "unrecognised link".
  it("rejects /share/ links with an actionable message", () => {
    const r = parsePostUrl("https://www.facebook.com/share/p/aBcDeF12345/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(FB_SHARE_LINK_REASON);
  });
});

// Facebook has no post-by-URL actor, so a post is found by scraping its PAGE and matching.
// That makes this function the hinge of the whole Facebook path: get it wrong and posts
// silently fail to resolve.
describe("facebookPageFrom", () => {
  it("takes the page slug out of a /posts/ or /videos/ permalink", () => {
    expect(facebookPageFrom("https://www.facebook.com/thepage/posts/1234567890")).toBe("thepage");
    expect(facebookPageFrom("https://www.facebook.com/thepage/videos/1234567890")).toBe("thepage");
    expect(facebookPageFrom("https://www.facebook.com/thepage/posts/pfbid0AbC")).toBe("thepage");
  });

  it("uses the numeric id param on a permalink.php link, not the path", () => {
    expect(facebookPageFrom("https://www.facebook.com/permalink.php?story_fbid=555&id=999")).toBe("999");
  });

  // Without the reserved-segment guard these would yield pages called "reel" and "watch",
  // and every scrape would hit a nonexistent page.
  it("returns null for links that name the post but not its page", () => {
    expect(facebookPageFrom("https://www.facebook.com/reel/1234567890")).toBeNull();
    expect(facebookPageFrom("https://www.facebook.com/watch/?v=1234567890")).toBeNull();
    expect(facebookPageFrom("https://www.facebook.com/share/p/aBcDeF/")).toBeNull();
    expect(facebookPageFrom("https://www.facebook.com/photo?fbid=123&set=a.1")).toBeNull();
  });

  it("survives m./www. prefixes and a missing scheme", () => {
    expect(facebookPageFrom("m.facebook.com/thepage/posts/123")).toBe("thepage");
    expect(facebookPageFrom("facebook.com/thepage/posts/123")).toBe("thepage");
  });

  it("returns null rather than throwing on junk", () => {
    expect(facebookPageFrom("not a url at all")).toBeNull();
    expect(facebookPageFrom("https://www.facebook.com/")).toBeNull();
  });
});

describe("parsePostUrl — rejections", () => {
  it("rejects an empty or blank string", () => {
    expect(parsePostUrl("").ok).toBe(false);
    expect(parsePostUrl("   ").ok).toBe(false);
  });

  it("names the unsupported host so the message is useful", () => {
    const r = parsePostUrl("https://twitter.com/someone/status/123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("twitter.com");
  });

  it("tolerates a missing scheme", () => {
    expect(parsePostUrl("instagram.com/p/CxYz123_-/").ok).toBe(true);
  });
});

// Page links go in the same box as post links — ingest tries the post parse first and falls
// back to this, so the operator never has to declare which kind of link they pasted.
describe("parseAccountUrl", () => {
  function acct(url: string) {
    const r = parseAccountUrl(url);
    if (!r.ok) throw new Error(`expected ${url} to parse, got: ${r.reason}`);
    return r.value;
  }

  it("reads an Instagram profile", () => {
    expect(acct("https://www.instagram.com/someone/")).toMatchObject({
      platform: "instagram",
      handle: "someone",
    });
  });

  // Without the reserved-segment guard, a post link would parse as an account called "p".
  it("does not mistake an Instagram post link for an account", () => {
    expect(parseAccountUrl("https://www.instagram.com/p/CxYz123/").ok).toBe(false);
    expect(parseAccountUrl("https://www.instagram.com/reel/CxYz123/").ok).toBe(false);
  });

  it("reads a Facebook page by slug and by numeric profile id", () => {
    expect(acct("https://www.facebook.com/thepage/")).toMatchObject({
      platform: "facebook",
      handle: "thepage",
    });
    expect(acct("https://www.facebook.com/profile.php?id=123456")).toMatchObject({
      platform: "facebook",
      handle: "123456",
    });
  });

  it("does not mistake a Facebook post link for a page", () => {
    expect(parseAccountUrl("https://www.facebook.com/reel/123").ok).toBe(false);
    expect(parseAccountUrl("https://www.facebook.com/watch/?v=123").ok).toBe(false);
  });

  // YouTube gives a channel three URL shapes and only two are resolvable by a cheap lookup.
  it("reads a YouTube channel by @handle and by channel id", () => {
    expect(acct("https://www.youtube.com/@SomeChannel")).toMatchObject({
      platform: "youtube",
      handle: "@SomeChannel",
    });
    expect(acct("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toMatchObject({
      platform: "youtube",
      handle: "UCabcdefghijklmnopqrstuv",
    });
  });

  // A /c/ vanity name resolves through neither forHandle nor id — only a search call, which
  // costs 100 quota units against a 10,000/day budget. Rejected with an instruction rather
  // than silently costing 100x a normal lookup.
  it("rejects legacy /c/ and /user/ YouTube links with an instruction", () => {
    const r = parseAccountUrl("https://www.youtube.com/c/SomeOldName");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/@handle/);
  });

  it("names an unsupported host", () => {
    const r = parseAccountUrl("https://tiktok.com/@someone");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("tiktok.com");
  });
});

describe("accountUrlFor", () => {
  it("builds the scraper input URL for each platform", () => {
    expect(accountUrlFor("instagram", "someone")).toBe("https://www.instagram.com/someone/");
    expect(accountUrlFor("facebook", "thepage")).toBe("https://www.facebook.com/thepage/");
    expect(accountUrlFor("youtube", "@Chan")).toBe("https://www.youtube.com/@Chan");
    expect(accountUrlFor("youtube", "UCabc")).toBe("https://www.youtube.com/channel/UCabc");
  });
});

describe("accountKeyFor", () => {
  it("prefixes with the platform and normalizes case and @", () => {
    expect(accountKeyFor("instagram", "@SomeOne")).toBe("instagram:someone");
  });

  // A bare handle is not unique once three platforms exist — this is the whole reason the
  // key is prefixed rather than being the handle itself.
  it("keeps the same handle on two platforms distinct", () => {
    expect(accountKeyFor("instagram", "brand")).not.toBe(accountKeyFor("facebook", "brand"));
  });
});

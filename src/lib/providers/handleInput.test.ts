import { describe, it, expect } from "vitest";
import { BULK_ADD_CHUNK_SIZE, MAX_BULK_ADD_HANDLES, normalizeHandleInput, parseHandleList } from "./handle-input";

/**
 * The bulk-add box exists so nobody has to paste thirty handles one at a time, which means the
 * thing it must survive is whatever shape those thirty arrive in — a column out of a
 * spreadsheet, a comma-separated line, a stack of URLs copied from the address bar.
 *
 * The failure this guards against is not a crash. `addFanPage` only strips a leading "@", so an
 * un-normalized `https://instagram.com/foo` fails its handle pattern with "not a valid Instagram
 * handle" — a real, confusing error on a line the user pasted correctly. The expensive inverse
 * is `instagram.com/p/Cxyz/`, which normalizes to the handle "p" if nobody stops it, passes the
 * pattern, and is then sent to Apify as a paid profile scrape of an account that does not exist.
 */
describe("normalizeHandleInput", () => {
  it("takes bare handles and @handles", () => {
    expect(normalizeHandleInput("fanpage_one", "instagram")).toBe("fanpage_one");
    expect(normalizeHandleInput("@fanpage_one", "instagram")).toBe("fanpage_one");
    expect(normalizeHandleInput("  @fanpage_one  ", "instagram")).toBe("fanpage_one");
  });

  it("takes Instagram profile URLs in every form people paste them", () => {
    for (const url of [
      "https://www.instagram.com/fanpage_one/",
      "https://instagram.com/fanpage_one",
      "instagram.com/fanpage_one/",
      "www.instagram.com/fanpage_one?hl=en",
      "https://www.instagram.com/fanpage_one/?igshid=abc#top",
    ]) {
      expect(normalizeHandleInput(url, "instagram"), url).toBe("fanpage_one");
    }
  });

  it("rejects Instagram content URLs instead of scraping a profile called @p", () => {
    expect(normalizeHandleInput("https://www.instagram.com/p/Cxyz123/", "instagram")).toBeNull();
    expect(normalizeHandleInput("https://www.instagram.com/reel/Cxyz123/", "instagram")).toBeNull();
    expect(normalizeHandleInput("https://www.instagram.com/stories/someone/123/", "instagram")).toBeNull();
    expect(normalizeHandleInput("https://www.instagram.com/explore/tags/xyz/", "instagram")).toBeNull();
  });

  it("takes YouTube handle, /c/, /user/ and /channel/ URLs", () => {
    expect(normalizeHandleInput("https://www.youtube.com/@channel_one", "youtube")).toBe("channel_one");
    expect(normalizeHandleInput("youtube.com/c/ChannelTwo", "youtube")).toBe("ChannelTwo");
    expect(normalizeHandleInput("https://youtube.com/user/ChannelThree", "youtube")).toBe("ChannelThree");
    expect(normalizeHandleInput("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", "youtube")).toBe(
      "UCabcdefghijklmnopqrstuv",
    );
  });

  it("rejects youtu.be links — a video short link has no channel in it", () => {
    expect(normalizeHandleInput("https://youtu.be/dQw4w9WgXcQ", "youtube")).toBeNull();
  });

  it("rejects anything that is not a handle after normalizing", () => {
    expect(normalizeHandleInput("", "instagram")).toBeNull();
    expect(normalizeHandleInput("   ", "instagram")).toBeNull();
    expect(normalizeHandleInput("not a handle", "instagram")).toBeNull();
    expect(normalizeHandleInput("@", "instagram")).toBeNull();
    // Over the platform's 30-character limit.
    expect(normalizeHandleInput("a".repeat(31), "instagram")).toBeNull();
    // Instagram handles have no hyphens; YouTube's do.
    expect(normalizeHandleInput("has-a-hyphen", "instagram")).toBeNull();
    expect(normalizeHandleInput("has-a-hyphen", "youtube")).toBe("has-a-hyphen");
  });

  it("strips the punctuation that comes with a copied spreadsheet cell or JSON array", () => {
    expect(normalizeHandleInput('"fanpage_one",', "instagram")).toBe("fanpage_one");
    expect(normalizeHandleInput("<https://instagram.com/fanpage_one>", "instagram")).toBe("fanpage_one");
  });
});

describe("parseHandleList", () => {
  it("splits on newlines, commas, semicolons and tabs alike", () => {
    const { handles } = parseHandleList("one\ntwo, three;four\tfive", "instagram");
    expect(handles).toEqual(["one", "two", "three", "four", "five"]);
  });

  it("does not split on spaces — a display name is one bad line, not four paid scrapes", () => {
    // The expensive mistake this prevents. Splitting on whitespace looks more forgiving, but a
    // display name pasted alongside the handles (what a copied spreadsheet actually gives you)
    // would become four valid-looking handles and four Apify profile scrapes of accounts that
    // do not exist. One unreadable line the user can see and fix costs nothing.
    const { handles, invalid } = parseHandleList("John Doe Fan Page\nreal_handle", "instagram");
    expect(handles).toEqual(["real_handle"]);
    expect(invalid).toEqual(["John Doe Fan Page"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling and the paste order", () => {
    const { handles, duplicates } = parseHandleList("Alpha\nbeta\nALPHA\nalpha", "instagram");
    expect(handles).toEqual(["Alpha", "beta"]);
    expect(duplicates).toBe(2);
  });

  it("counts a URL and the bare handle it points at as the same page", () => {
    // The whole point of de-duplicating after normalization rather than before: these two lines
    // look nothing alike and are one paid scrape, not two.
    const { handles, duplicates } = parseHandleList("https://instagram.com/fanpage_one/\n@fanpage_one", "instagram");
    expect(handles).toEqual(["fanpage_one"]);
    expect(duplicates).toBe(1);
  });

  it("keeps unreadable lines verbatim rather than silently dropping them", () => {
    const { handles, invalid } = parseHandleList("good_one\nhttps://instagram.com/p/Cxyz/\nbad handle", "instagram");
    expect(handles).toEqual(["good_one"]);
    expect(invalid).toEqual(["https://instagram.com/p/Cxyz/", "bad handle"]);
  });

  it("ignores blank input", () => {
    expect(parseHandleList("", "instagram")).toEqual({ handles: [], invalid: [], duplicates: 0 });
    expect(parseHandleList("\n\n  \n", "instagram")).toEqual({ handles: [], invalid: [], duplicates: 0 });
  });
});

describe("bulk-add chunk sizing", () => {
  /**
   * Instagram's chunk size is load-bearing, not cosmetic. scrapeByHandle is two Apify runs, each
   * waiting up to DEFAULT_WAIT_MS (5 min), so ~600s worst case for one handle against the
   * /fan-pages page's maxDuration of 800s. Raise this above 1 and a slow pair of handles returns
   * a 504 that discards the results of everything already done in that call.
   */
  it("sends Instagram handles one per call", () => {
    expect(BULK_ADD_CHUNK_SIZE.instagram).toBe(1);
  });

  it("caps the action at the largest chunk any platform sends", () => {
    expect(MAX_BULK_ADD_HANDLES).toBe(Math.max(...Object.values(BULK_ADD_CHUNK_SIZE)));
    expect(MAX_BULK_ADD_HANDLES).toBeGreaterThanOrEqual(BULK_ADD_CHUNK_SIZE.instagram);
  });
});

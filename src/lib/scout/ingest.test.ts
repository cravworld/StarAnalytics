import { describe, expect, it } from "vitest";
import { parseInfluencerListText, profileUrlKey } from "./ingest";

// Fixture shaped like the real `unpdf` extraction of a narrow-column table exported from
// Google Sheets to PDF (confirmed live against "BKU X Snakeplant.pdf", 2026-08-17): each row
// is "N NAME" on its own line, then the URL/igsh wraps across several continuation lines
// with no inserted spaces (word-wrapped mid-string, not tab-prefixed — unlike the earlier
// pdf-parse-based extraction this replaced), ending with the DELIVERABLES value.
const FIXTURE = [
  "Influencer List",
  "NUMBER NAME LINK DELIVERABLES",
  "1 JEEVA",
  "https://www.",
  "instagram.",
  "com/iamjeevaa?",
  "igsh=OHl3dm5n",
  "eW9kem5i STORY",
  "2 SHIYON SAJI",
  "https://www.",
  "instagram.",
  "com/shiyonsaji",
  "music?",
  "igsh=MXUzYTg",
  "3YTl6ZGo0Yg=",
  "= REEL",
  "3 DUPLICATE OF ROW 1",
  "https://www.",
  "instagram.",
  "com/IamJeevaa?",
  "igsh=xyz REEL",
  "4 MISSING DELIVERABLE",
  "https://www.",
  "instagram.",
  "com/nodelivrbl?",
  "igsh=zzz",
  "PARVATHY NAIR",
  "https://www.",
  "instagram.",
  "com/parvathy__",
  "nair____?",
  "igsh=abc REEL",
  "5 A FACEBOOK PAGE",
  "https://www.facebook.com/MarvelStudios",
  " REEL",
].join("\n");

describe("parseInfluencerListText", () => {
  it("extracts row number, name, handle, and deliverable for a normal row", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    expect(candidates[0]).toEqual({
      rowNumber: 1,
      name: "JEEVA",
      platform: "instagram",
      handle: "iamjeevaa",
      profileUrl: "https://www.instagram.com/iamjeevaa/",
      deliverable: "STORY",
    });
  });

  it("recognizes a facebook.com link and tags it as the facebook platform", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    const fb = candidates.find((c) => c.platform === "facebook");
    expect(fb).toMatchObject({
      handle: "marvelstudios",
      profileUrl: "https://www.facebook.com/MarvelStudios/",
      deliverable: "REEL",
    });
  });

  it("reassembles a handle that word-wraps mid-string across PDF lines", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    expect(candidates[1].handle).toBe("shiyonsajimusic");
    expect(candidates[1].deliverable).toBe("REEL");
  });

  it("dedupes the same account listed twice (case-insensitively), keeping the first row", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    expect(candidates.filter((c) => c.handle === "iamjeevaa")).toHaveLength(1);
    expect(candidates.find((c) => c.handle === "iamjeevaa")?.rowNumber).toBe(1); // first row wins
  });

  it("still extracts a row whose DELIVERABLES value is missing, instead of swallowing every row after it", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    const noDeliverable = candidates.find((c) => c.handle === "nodelivrbl");
    expect(noDeliverable).toBeDefined();
    expect(noDeliverable?.deliverable).toBeNull();
    // and the row right after it (which has no leading number) still parsed correctly,
    // proving it wasn't absorbed into the row-4 block.
    const parvathy = candidates.find((c) => c.handle === "parvathy__nair____");
    expect(parvathy?.rowNumber).toBeNull();
    expect(parvathy?.name).toBe("PARVATHY NAIR");
  });

  it("counts every URL block toward rowsFound, and only ones with a usable link toward rowsParsed", () => {
    const { rowsFound, rowsParsed } = parseInfluencerListText(FIXTURE);
    expect(rowsFound).toBe(6);
    expect(rowsParsed).toBe(5); // row 3 is a dup of row 1's handle
  });

  it("reports a parse shortfall rather than silently dropping rows", () => {
    const shortfall = parseInfluencerListText("NAME ONLY\nno link here at all\n");
    expect(shortfall.rowsFound).toBe(0); // neither line even starts a URL block
    expect(shortfall.rowsParsed).toBe(0);
  });
});

describe("profileUrlKey", () => {
  it("normalizes a full URL and a bare handle to the same platform-prefixed key", () => {
    expect(profileUrlKey("https://www.instagram.com/SomeHandle/")).toBe("instagram:somehandle");
    expect(profileUrlKey("SomeHandle")).toBe("instagram:somehandle");
  });

  it("detects facebook.com URLs and prefixes the key with facebook instead", () => {
    expect(profileUrlKey("https://www.facebook.com/SomePage/")).toBe("facebook:somepage");
  });

  it("keeps instagram and facebook keys distinct for the same-looking handle", () => {
    expect(profileUrlKey("https://www.instagram.com/marvel/")).not.toBe(
      profileUrlKey("https://www.facebook.com/marvel/"),
    );
  });
});

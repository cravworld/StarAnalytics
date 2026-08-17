import { describe, expect, it } from "vitest";
import { parseInfluencerListText, profileUrlKey } from "./ingest";

// Fixture shaped like the real pdf-parse extraction of a narrow-column table exported from
// Google Sheets to PDF (confirmed live against "BKU X Snakeplant.pdf", 2026-08-17): each row
// is "N\tNAME" on its own line, the URL/igsh wraps across tab-prefixed continuation lines
// with no inserted spaces, and a couple of trailing rows have no row number at all.
const FIXTURE = [
  "Influencer List",
  "NUMBER \tNAME \tLINK \tDELIVERABLES",
  "1 \tJEEVA",
  "https://www.",
  "\tinstagram.",
  "\tcom/iamjeevaa?",
  "\tigsh=OHl3dm5n",
  "\teW9kem5i \tSTORY",
  "2 \tSHIYON SAJI",
  "https://www.",
  "\tinstagram.",
  "\tcom/shiyonsaji",
  "\tmusic?",
  "\tigsh=MXUzYTg",
  "\t3YTl6ZGo0Yg=",
  "\t= \tREEL",
  "3 \tDUPLICATE OF ROW 1",
  "https://www.",
  "\tinstagram.",
  "\tcom/IamJeevaa?",
  "\tigsh=xyz \tREEL",
  "PARVATHY NAIR",
  "https://www.",
  "\tinstagram.",
  "\tcom/parvathy__",
  "\tnair____?",
  "\tigsh=abc \tREEL",
].join("\n");

describe("parseInfluencerListText", () => {
  it("extracts row number, name, handle, and deliverable for a normal row", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    expect(candidates[0]).toEqual({
      rowNumber: 1,
      name: "JEEVA",
      handle: "iamjeevaa",
      profileUrl: "https://www.instagram.com/iamjeevaa/",
      deliverable: "STORY",
    });
  });

  it("reassembles a handle that word-wraps mid-string across PDF lines", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    expect(candidates[1].handle).toBe("shiyonsajimusic");
    expect(candidates[1].deliverable).toBe("REEL");
  });

  it("dedupes the same account listed twice (case-insensitively), keeping the first row", () => {
    const { candidates, rowsFound, rowsParsed } = parseInfluencerListText(FIXTURE);
    expect(rowsFound).toBe(4);
    expect(rowsParsed).toBe(3); // row 3 is a dup of row 1's handle
    expect(candidates.filter((c) => c.handle === "iamjeevaa")).toHaveLength(1);
    expect(candidates.find((c) => c.handle === "iamjeevaa")?.rowNumber).toBe(1); // first row wins
  });

  it("handles a row with no leading number", () => {
    const { candidates } = parseInfluencerListText(FIXTURE);
    const last = candidates[candidates.length - 1];
    expect(last.rowNumber).toBeNull();
    expect(last.name).toBe("PARVATHY NAIR");
    expect(last.handle).toBe("parvathy__nair____");
  });

  it("reports a parse shortfall rather than silently dropping rows", () => {
    const shortfall = parseInfluencerListText("NAME ONLY\nno link here at all\n");
    expect(shortfall.rowsFound).toBe(2); // both lines look like record starts, neither has a link
    expect(shortfall.rowsParsed).toBe(0);
  });
});

describe("profileUrlKey", () => {
  it("normalizes a full URL and a bare handle to the same key", () => {
    expect(profileUrlKey("https://www.instagram.com/SomeHandle/")).toBe("somehandle");
    expect(profileUrlKey("SomeHandle")).toBe("somehandle");
  });
});

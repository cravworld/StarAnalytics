import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The fan-page screens opt into the comment scrape explicitly, and that opt-in is the only
 * reason their comment panels have anything to show while COMMENT_SCRAPE is globally off
 * (see isCommentScrapeEnabled). Nothing else would catch it going missing: drop the argument
 * and every call still compiles, still runs, still classifies — the comment panels just
 * quietly stay empty forever, which looks exactly like "this page has no comments".
 *
 * Equally, the CRON path must NOT opt in. That one runs unattended every hour, and comments
 * are the metered part; an opt-in there would turn a switched-off pipeline back on by the
 * side door. Asserted below as the inverse case, because "we didn't pass a flag" is only
 * meaningful if something checks.
 */
const queueSentimentClassification = vi.fn();
const addFanPage = vi.fn(async () => ["post-1", "post-2"]);
const pullFanPageHistory = vi.fn(async () => ({ postIds: ["post-3"], postCount: 1 }));
const refreshFanPages = vi.fn(async () => [{ handle: "a", ok: true, postCount: 2 }]);

vi.mock("@/lib/data/sentiment", () => ({ queueSentimentClassification }));
vi.mock("@/lib/data/fanpages", () => ({
  addFanPage,
  pullFanPageHistory,
  refreshFanPages,
  setFanPageVerified: vi.fn(),
  stopTrackingFanPage: vi.fn(),
}));
vi.mock("@/lib/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() defers work past the response in Next; run it inline so the assertion can see it.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

describe("fan-page actions and the comment scrape", () => {
  beforeEach(() => {
    queueSentimentClassification.mockClear();
  });

  it("adding a fan page opts into the comment scrape", async () => {
    const { addFanPageAction } = await import("./fanpages");
    await addFanPageAction("someone");
    expect(queueSentimentClassification).toHaveBeenCalledWith(
      ["post-1", "post-2"],
      { scrapeComments: true },
    );
  });

  it("the manual refresh opts into the comment scrape", async () => {
    const { pullFanPageHistoryAction } = await import("./fanpages");
    await pullFanPageHistoryAction("fan-page-id");
    expect(queueSentimentClassification).toHaveBeenCalledWith(["post-3"], { scrapeComments: true });
  });

  it("Refresh all opts in, and forces past the TTL", async () => {
    const { refreshAllFanPagesAction } = await import("./fanpages");
    await refreshAllFanPagesAction();
    expect(refreshFanPages).toHaveBeenCalledWith({
      force: true,
      sentimentOpts: { scrapeComments: true },
    });
  });

  it("the cron refresh does NOT opt in — it inherits the global default", async () => {
    // refreshStaleFanPages and refreshFanPages share one loop now, and which of them scrapes
    // comments is decided purely by whether `sentimentOpts` is passed. So the property worth
    // pinning is that the cron's entry point forwards no sentiment options at all — assert it
    // against the real source, since the module is mocked for the cases above.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../data/fanpages.ts", import.meta.url), "utf8");
    const body = src.match(/export async function refreshStaleFanPages[\s\S]*?\n}/)?.[0] ?? "";
    expect(body, "refreshStaleFanPages not found — did it get renamed?").toContain("refreshFanPages(");
    expect(body, "the cron must not pass sentiment options").not.toContain("sentimentOpts");
    expect(body, "the cron must not opt into the comment scrape").not.toContain("scrapeComments");
  });
});

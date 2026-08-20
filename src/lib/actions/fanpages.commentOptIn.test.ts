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
const addFanPages = vi.fn(async () => ({
  results: [{ handle: "a", ok: true, status: "added" as const, postCount: 2 }],
  postIds: ["post-4", "post-5"],
}));
const pullFanPageHistory = vi.fn(async () => ({ postIds: ["post-3"], postCount: 1 }));
const refreshFanPages = vi.fn(async () => [{ handle: "a", ok: true, postCount: 2 }]);

vi.mock("@/lib/data/sentiment", () => ({ queueSentimentClassification }));
vi.mock("@/lib/data/fanpages", () => ({
  addFanPage,
  addFanPages,
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

  it("bulk add does NOT opt in — one click no longer means one page", async () => {
    // The single-add opt-in is justified by "a human clicked, and the scrape is bounded to one
    // page's recent posts". A pasted list voids both halves: one click stands for N pages and
    // the bound becomes N x 50 posts, which at ~20 comments each is the unbounded comment
    // fan-out the Apify audit calls finding A — roughly $2.30 a page against $0.08 for the
    // profile and post pull alone. Pinned as the inverse case, because "we didn't pass a flag"
    // is only meaningful if something checks: adding FAN_PAGE_SENTIMENT_OPTS here would compile,
    // run, and quietly multiply the bill by ~30.
    const { addFanPagesBulkAction } = await import("./fanpages");
    await addFanPagesBulkAction(["someone"]);
    expect(queueSentimentClassification).toHaveBeenCalledWith(["post-4", "post-5"]);
  });

  it("bulk add refuses a batch larger than the action's cap", async () => {
    // A Server Action is a public POST endpoint; the client's chunk size is a convention, not a
    // guarantee, and an oversized batch is exactly what blows the page's maxDuration budget.
    const { addFanPagesBulkAction } = await import("./fanpages");
    const { MAX_BULK_ADD_HANDLES } = await import("@/lib/providers/handle-input");
    const tooMany = Array.from({ length: MAX_BULK_ADD_HANDLES + 1 }, (_, i) => `handle${i}`);
    await expect(addFanPagesBulkAction(tooMany)).rejects.toThrow(/too many handles/);
    await expect(addFanPagesBulkAction([])).rejects.toThrow(/no handles/);
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

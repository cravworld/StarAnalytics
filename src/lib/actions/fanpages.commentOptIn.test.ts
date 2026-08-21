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
const refreshFanPages = vi.fn(async () => [{ id: "page-1", handle: "a", ok: true, postCount: 2 }]);

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
const revalidatePathSpy = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePathSpy(p) }));
// after() defers work past the response in Next; run it inline so the assertion can see it.
// Kept as a spy as well, because one test below asserts a path deliberately does NOT defer.
const afterSpy = vi.fn((fn: () => unknown) => fn());
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterSpy(fn) }));

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

  it("bulk add opts into the comment scrape, exactly like adding by hand", async () => {
    // Bulk is meant to be "the same operation, N times". If this flag went missing, a page added
    // from a pasted list would end up with thinner data than the identical page added by hand,
    // and nothing would say so — the comment panels would just be empty, which looks exactly
    // like a page that has no comments.
    const { addFanPagesBulkAction } = await import("./fanpages");
    await addFanPagesBulkAction(["someone"]);
    expect(queueSentimentClassification).toHaveBeenCalledWith(["post-4", "post-5"], { scrapeComments: true });
  });

  it("bulk add AWAITS the comment scrape instead of deferring it past the response", async () => {
    // Load-bearing, and invisible if it regresses. The comment scrape takes a global
    // COMMENT_SCRAPE_LOCK, and losing that lock is deliberately not an error: the pass logs and
    // falls back to caption-only. Deferred with after(), chunk N's scrape is still holding the
    // lock when the client's next chunk arrives, so the first page of a pasted list gets its
    // comments and every page after it silently gets none. Awaiting is what makes the client's
    // sequential loop serialize the lock. Asserted by proving this path did not route through
    // after() at all — the failure it guards against is a "harmless" tidy-up that wraps the call
    // to match the three paths around it.
    const { addFanPagesBulkAction } = await import("./fanpages");
    afterSpy.mockClear();
    await addFanPagesBulkAction(["someone"]);
    expect(queueSentimentClassification).toHaveBeenCalledWith(["post-4", "post-5"], { scrapeComments: true });
    expect(afterSpy, "the bulk comment scrape must not be deferred — see the lock note").not.toHaveBeenCalled();
  });

  it("bulk add revalidates only when the caller says this is the last chunk", async () => {
    // revalidatePath does not merely invalidate a cache here: it makes the action's response
    // carry a freshly rendered RSC payload for the whole route, which the client commits as a
    // seeded navigation. Called once per chunk, a twelve-handle paste therefore triggered twelve
    // full re-renders of /fan-pages mid-run — wasted getFanPagesData passes against a
    // 5-connection pool while scrapes were in flight, and twelve commits into the tree holding
    // the progress and result state the screen exists to show.
    const { addFanPagesBulkAction } = await import("./fanpages");
    revalidatePathSpy.mockClear();
    await addFanPagesBulkAction(["someone"], "instagram", false);
    expect(revalidatePathSpy, "a non-final chunk must not re-render the route").not.toHaveBeenCalled();

    await addFanPagesBulkAction(["someone"], "instagram", true);
    expect(revalidatePathSpy).toHaveBeenCalledWith("/fan-pages");
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

  it("Refresh all opts in, forces past the TTL, and refreshes only the ids it was given", async () => {
    // The `ids` filter is what keeps this request survivable. Refreshing every page in one action
    // exceeded maxDuration at 33 tracked pages — killed mid-loop, 504 at the browser, some pages
    // committed and no report of which. If this stopped passing ids the action would silently go
    // back to refreshing the whole table on every chunk, which is both the old timeout and N
    // times the work.
    const { refreshFanPagesChunkAction } = await import("./fanpages");
    await refreshFanPagesChunkAction(["page-1"]);
    expect(refreshFanPages).toHaveBeenCalledWith({
      force: true,
      ids: ["page-1"],
      sentimentOpts: { scrapeComments: true },
    });
  });

  it("Refresh all revalidates only on the final chunk, and caps the batch", async () => {
    const { refreshFanPagesChunkAction } = await import("./fanpages");
    const { MAX_BULK_ADD_HANDLES } = await import("@/lib/providers/handle-input");
    revalidatePathSpy.mockClear();
    await refreshFanPagesChunkAction(["page-1"], false);
    expect(revalidatePathSpy, "a non-final chunk must not re-render the route").not.toHaveBeenCalled();

    await refreshFanPagesChunkAction(["page-1"], true);
    expect(revalidatePathSpy).toHaveBeenCalledWith("/fan-pages");

    const tooMany = Array.from({ length: MAX_BULK_ADD_HANDLES + 1 }, (_, i) => `page-${i}`);
    await expect(refreshFanPagesChunkAction(tooMany)).rejects.toThrow(/too many pages/);
    await expect(refreshFanPagesChunkAction([])).rejects.toThrow(/no pages/);
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

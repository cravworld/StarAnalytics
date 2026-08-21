import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The batch cron's selection query, pinned because getting it wrong fails silently and forever.
 *
 * refreshFanPages skips fresh pages inside its loop via isStale(). That is correct when the query
 * returns every active page. Combined with `take: limit` it is a trap: the query would hand back
 * the first N pages in whatever order, the loop would skip them all as fresh, and the run would
 * refresh nothing — every time, because the same N come back. The screen would look like the cron
 * was working (it returns 200, it reports zero failures) while nothing ever got refreshed.
 *
 * So when `limit` is set the staleness filter has to be in the WHERE clause, the ordering has to
 * be oldest-first, and NULLs — pages never checked at all, the most stale thing there is — have to
 * sort first rather than last, which is not Postgres's default for ASC.
 */
// Typed with an explicit arg so the assertions below can read back the query it was called with.
const findMany = vi.fn(async (_args?: Record<string, unknown>): Promise<unknown[]> => []);
const queueSentimentClassification = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fanPage: { findMany, findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    post: { findMany: vi.fn(async () => []) },
    alert: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/data/sentiment", () => ({ queueSentimentClassification }));
vi.mock("@/lib/providers/apify-public-content", () => ({ backfillFanPageLink: vi.fn() }));
vi.mock("@/lib/data/accountSnapshots", () => ({
  getFollowerTrends: vi.fn(),
  lookupTrend: vi.fn(),
  recordAccountSnapshot: vi.fn(),
}));

describe("refreshFanPagesBatch selection", () => {
  beforeEach(() => {
    findMany.mockClear();
    queueSentimentClassification.mockClear();
  });

  it("filters by staleness in SQL, oldest first, NULLs first, and takes only the batch", async () => {
    const { refreshFanPagesBatch } = await import("./fanpages");
    await refreshFanPagesBatch(2);

    const arg = findMany.mock.calls[0][0] as unknown as {
      where: { isActive: boolean; OR?: unknown[] };
      orderBy: Record<string, unknown>;
      take?: number;
    };

    expect(arg.take, "the batch must be capped in SQL, not by slicing afterwards").toBe(2);
    expect(arg.where.isActive).toBe(true);
    expect(
      arg.where.OR,
      "staleness must be a WHERE condition — filtering it in the loop instead means a batch of fresh pages refreshes nothing, forever",
    ).toBeDefined();
    expect(arg.orderBy).toEqual({ lastCheckedAt: { sort: "asc", nulls: "first" } });
  });

  it("refreshes everything when no limit is given, and does not filter by staleness in SQL", async () => {
    // The "Refresh all" button and the id-scoped chunk path both rely on this: they do their own
    // TTL decision (force, or an explicit id list), so the query must not pre-filter for them.
    const { refreshFanPages } = await import("./fanpages");
    await refreshFanPages({ force: true });

    const arg = findMany.mock.calls[0][0] as unknown as { where: { OR?: unknown[] }; take?: number };
    expect(arg.take).toBeUndefined();
    expect(arg.where.OR).toBeUndefined();
  });
});

describe("refreshFanPagesBatch and the comment scrape", () => {
  beforeEach(() => {
    findMany.mockClear();
    queueSentimentClassification.mockClear();
  });

  /**
   * This is the inverse of the pin on refreshStaleFanPages in actions/fanpages.commentOptIn.test,
   * and the two must not be "unified". They differ on purpose:
   *
   * - refreshStaleFanPages refreshes EVERY stale page in one unbounded pass, so it inherits the
   *   global (off) comment default — an opt-in there would switch a disabled pipeline back on by
   *   the side door, across an arbitrary number of pages.
   * - refreshFanPagesBatch is bounded to `limit` pages per run by construction, and exists
   *   precisely so a background refresh produces the same data as pressing the button. Without
   *   comments it would produce thinner data than the thing it replaces, which is the whole
   *   reason the user could not simply leave it to the existing cron.
   */
  it("opts into the comment scrape, unlike the unbounded stale refresh", async () => {
    // Asserted against the real source rather than by driving the function: reaching the sentiment
    // call for real means letting scrapeFanPageFull run, which needs the whole provider layer
    // stubbed, and a test that stubs that much stops testing this and starts testing the stubs.
    // Worse, it fails open — the provider throws, the sentiment call never happens, and an
    // assertion on "what it was called with" passes vacuously while proving nothing. The property
    // here is a one-line fact about the source, so read the source.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./fanpages.ts", import.meta.url), "utf8");

    const batch = src.match(/export async function refreshFanPagesBatch[\s\S]*?\n}/)?.[0] ?? "";
    expect(batch, "refreshFanPagesBatch not found — did it get renamed?").toContain("refreshFanPages(");
    expect(batch, "the batch cron must scrape comments — that is why it exists").toContain(
      "scrapeComments: true",
    );

    const stale = src.match(/export async function refreshStaleFanPages[\s\S]*?\n}/)?.[0] ?? "";
    expect(stale, "refreshStaleFanPages not found — did it get renamed?").toContain("refreshFanPages(");
    expect(
      stale,
      "the unbounded stale refresh must NOT opt in — see the comment above these two functions",
    ).not.toContain("scrapeComments");
  });
});

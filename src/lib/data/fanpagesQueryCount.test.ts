import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Fan Pages list must issue a number of database queries that does NOT grow with the
 * number of tracked pages.
 *
 * This is a regression pin for a real production incident. fanPageRow used to run its own
 * `Promise.all` of six queries, and getFanPagesData mapped it over every active page, so the
 * screen fired 6N concurrent queries against Prisma's default pool of 5 connections. With one
 * tracked page that was six queries and nobody noticed. At ten it was sixty, and
 * `GET /fan-pages` began failing in production with P2024 "Timed out fetching a new connection
 * from the connection pool" — intermittently, since whether it tipped over depended on how
 * warm the pool was, which is exactly what made it hard to recognise from the symptom.
 *
 * Asserting a fixed query count would be the obvious test and the wrong one: it would fail
 * every time someone legitimately adds a query, teaching people to bump the number. What
 * actually matters is the shape — the count at 1 page and the count at 40 pages must be
 * identical. A reintroduced per-page query fails that no matter how many queries the screen
 * makes overall.
 *
 * Counting is done against a mocked prisma client rather than a real database: the property
 * under test is "how many queries", which needs no rows to be true, and a timing-based test
 * against a constrained pool would be flaky for the same reason the bug was intermittent.
 */

interface Call {
  model: string;
  op: string;
}

let calls: Call[] = [];

/** Records the call and returns something each call site can destructure without caring. */
function recorder(model: string, op: string, result: unknown) {
  return vi.fn(async () => {
    calls.push({ model, op });
    return result;
  });
}

const prisma = {
  fanPage: { findMany: recorder("fanPage", "findMany", []) },
  post: {
    findMany: recorder("post", "findMany", []),
    groupBy: recorder("post", "groupBy", []),
    count: recorder("post", "count", 0),
    findFirst: recorder("post", "findFirst", null),
  },
  alert: { findMany: recorder("alert", "findMany", []) },
  $queryRaw: recorder("$raw", "queryRaw", []),
};

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/data/accountSnapshots", () => ({
  // Already batched — one query for every handle — and mocked out here so its own query
  // does not have to be modelled. The screen's other set-wide queries are enough to prove
  // the shape.
  getFollowerTrends: vi.fn(async () => new Map()),
  lookupTrend: () => ({ values: [], deltaPct: null }),
  recordAccountSnapshot: vi.fn(),
}));

function fakePages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `page-${i}`,
    platform: "instagram" as const,
    igHandle: `handle${i}`,
    displayName: `Page ${i}`,
    followers: 1000 + i,
    isVerifiedFan: false,
    isActive: true,
  }));
}

async function queryCountFor(pageCount: number): Promise<number> {
  calls = [];
  prisma.fanPage.findMany.mockImplementation(async () => {
    calls.push({ model: "fanPage", op: "findMany" });
    return fakePages(pageCount);
  });
  const { getFanPagesData } = await import("./fanpages");
  await getFanPagesData();
  return calls.length;
}

describe("Fan Pages list query count", () => {
  beforeEach(() => {
    calls = [];
  });

  it("does not grow with the number of tracked fan pages", async () => {
    const one = await queryCountFor(1);
    const forty = await queryCountFor(40);

    expect(forty, `1 page issued ${one} queries, 40 pages issued ${forty} — the list is querying per page again`).toBe(one);
  });

  it("issues no per-page post queries at all", async () => {
    await queryCountFor(12);

    // The six that used to run once per page. post.findMany survives as the single set-wide
    // fetch, so it is checked by count rather than by absence.
    expect(calls.filter((c) => c.model === "post" && c.op === "count")).toHaveLength(0);
    expect(calls.filter((c) => c.model === "post" && c.op === "findFirst")).toHaveLength(0);
    expect(calls.filter((c) => c.model === "post" && c.op === "findMany")).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The campaigns and compare screens must issue a number of queries that does NOT grow with
 * the number of campaigns, competitors or tracked hashtags on them.
 *
 * Same property, same reason, as fanpagesQueryCount.test.ts. `/fan-pages` ran six queries per
 * tracked page and worked fine at one page; it started returning P2024 "Timed out fetching a
 * new connection from the connection pool" in production once ten pages were tracked. These
 * screens had the identical shape and had simply not been given enough rows to fail yet —
 * measured before the fix: two queries per campaign on the list, one per tracked hashtag
 * inside campaign detail, one per competitor on Compare.
 *
 * Comparing the count at one item against the count at forty, rather than asserting a fixed
 * number, is deliberate: a fixed number fails whenever someone legitimately adds a query and
 * teaches people to bump it, while the ratio test only fails for the thing that actually
 * matters — a query that runs once per row.
 *
 * getCampaignCompareData and sendWeeklyDigest are excluded here on purpose. They call
 * getCampaignDetail once per campaign, which is a composite that cannot collapse into a
 * set-wide query without dismantling it, so they are bounded by CAMPAIGN_DETAIL_CONCURRENCY
 * instead of made constant. Their protection is the cap, not a flat count.
 */

interface Call {
  model: string;
  op: string;
}

let calls: Call[] = [];

function recorder(model: string, op: string, result: unknown) {
  return vi.fn(async () => {
    calls.push({ model, op });
    return result;
  });
}

const prisma = {
  campaign: { findMany: recorder("campaign", "findMany", []), findUnique: recorder("campaign", "findUnique", null) },
  post: {
    findMany: recorder("post", "findMany", []),
    groupBy: recorder("post", "groupBy", []),
    count: recorder("post", "count", 0),
    aggregate: recorder("post", "aggregate", { _sum: { likes: 0, comments: 0 } }),
  },
  sentiment: { findMany: recorder("sentiment", "findMany", []) },
  competitorAccount: { findMany: recorder("competitorAccount", "findMany", []) },
  hashtagSnapshot: {
    findMany: recorder("hashtagSnapshot", "findMany", []),
    groupBy: recorder("hashtagSnapshot", "groupBy", []),
  },
  $queryRaw: recorder("$raw", "queryRaw", []),
};

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/data/accountSnapshots", () => ({
  getFollowerTrends: vi.fn(async () => new Map()),
  lookupTrend: () => ({ values: [], deltaPct: null }),
  recordAccountSnapshot: vi.fn(),
}));

function fakeCampaigns(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `campaign-${i}`,
    name: `Campaign ${i}`,
    status: "live",
    hashtags: [`tag${i}a`, `tag${i}b`],
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    type: null,
  }));
}

function fakeCompetitors(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `competitor-${i}`,
    platform: "instagram" as const,
    igHandle: `rival${i}`,
    displayName: `Rival ${i}`,
    followers: 5000,
    lastScrapedAt: new Date("2026-08-01T00:00:00Z"),
  }));
}

async function countWith(setup: () => void, run: () => Promise<unknown>): Promise<number> {
  calls = [];
  setup();
  await run();
  return calls.length;
}

describe("campaigns and compare query counts", () => {
  beforeEach(() => {
    calls = [];
  });

  it("the campaigns list does not query per campaign", async () => {
    const { getOwnCampaigns } = await import("./campaigns");

    const one = await countWith(
      () => prisma.campaign.findMany.mockImplementation(async () => {
        calls.push({ model: "campaign", op: "findMany" });
        return fakeCampaigns(1);
      }),
      () => getOwnCampaigns(),
    );
    const forty = await countWith(
      () => prisma.campaign.findMany.mockImplementation(async () => {
        calls.push({ model: "campaign", op: "findMany" });
        return fakeCampaigns(40);
      }),
      () => getOwnCampaigns(),
    );

    expect(forty, `1 campaign issued ${one} queries, 40 issued ${forty}`).toBe(one);
    // The two that used to run per campaign.
    expect(calls.filter((c) => c.op === "count" || c.op === "aggregate")).toHaveLength(0);
  });

  it("Compare does not query per competitor", async () => {
    const { getCompareData } = await import("./compare");

    const one = await countWith(
      () => prisma.competitorAccount.findMany.mockImplementation(async () => {
        calls.push({ model: "competitorAccount", op: "findMany" });
        return fakeCompetitors(1);
      }),
      () => getCompareData(),
    );
    const forty = await countWith(
      () => prisma.competitorAccount.findMany.mockImplementation(async () => {
        calls.push({ model: "competitorAccount", op: "findMany" });
        return fakeCompetitors(40);
      }),
      () => getCompareData(),
    );

    expect(forty, `1 competitor issued ${one} queries, 40 issued ${forty}`).toBe(one);
  });

  it("the day-N comparison does not query per campaign", async () => {
    const { getCampaignCompareDataAtDay } = await import("./campaigns");

    const one = await countWith(
      () => prisma.campaign.findMany.mockImplementation(async () => {
        calls.push({ model: "campaign", op: "findMany" });
        return fakeCampaigns(1);
      }),
      () => getCampaignCompareDataAtDay(["campaign-0"], 7),
    );
    const forty = await countWith(
      () => prisma.campaign.findMany.mockImplementation(async () => {
        calls.push({ model: "campaign", op: "findMany" });
        return fakeCampaigns(40);
      }),
      () => getCampaignCompareDataAtDay(fakeCampaigns(40).map((c) => c.id), 7),
    );

    expect(forty, `1 campaign issued ${one} queries, 40 issued ${forty}`).toBe(one);
  });

  it("the tracked-hashtag table does not query per hashtag", async () => {
    const { getTrackedHashtags } = await import("./campaigns");

    const snapshotsFor = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        hashtag: `tag${i}`,
        snapshotAt: new Date("2026-08-01T00:00:00Z"),
        postCount: 3,
      }));

    const one = await countWith(
      () => prisma.hashtagSnapshot.findMany.mockImplementation(async () => {
        calls.push({ model: "hashtagSnapshot", op: "findMany" });
        return snapshotsFor(1);
      }),
      () => getTrackedHashtags(),
    );
    const forty = await countWith(
      () => prisma.hashtagSnapshot.findMany.mockImplementation(async () => {
        calls.push({ model: "hashtagSnapshot", op: "findMany" });
        return snapshotsFor(40);
      }),
      () => getTrackedHashtags(),
    );

    expect(forty, `1 hashtag issued ${one} queries, 40 issued ${forty}`).toBe(one);
  });
});

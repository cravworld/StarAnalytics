import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The post tracker screen must issue a number of queries that does NOT grow with the number
 * of tracked posts or the number of accounts that posted them.
 *
 * Same property, same reason, as campaignsQueryCount.test.ts and fanpagesQueryCount.test.ts.
 * `/fan-pages` ran six queries per tracked page and worked fine at one page; it started
 * returning P2024 "Timed out fetching a new connection from the connection pool" in
 * production once ten pages were tracked, against a 5-connection pool. This screen has the
 * identical shape — a grid of N cards, each of which "just needs" its account's follower
 * count and its own snapshot history — and would fail the same way at the same size.
 *
 * The two shapes this test is built to catch:
 *   - a findFirst per account for the latest follower snapshot
 *   - a findMany per account for its Scoutline baseline
 * Both are natural to write and both are one-query-per-row. getCampaignTracking fetches each
 * set-wide with one `findMany ... where id in [...]` and indexes the result in memory.
 *
 * Comparing the count at one post against the count at forty, rather than asserting a fixed
 * number, is deliberate: a fixed number fails whenever someone legitimately adds a query and
 * teaches people to bump it, while the ratio test only fails for the thing that actually
 * matters.
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
  campaign: {
    findUnique: recorder("campaign", "findUnique", { id: "campaign-1", name: "Test Campaign" }),
    findMany: recorder("campaign", "findMany", []),
  },
  trackedPost: {
    findMany: recorder("trackedPost", "findMany", []),
    groupBy: recorder("trackedPost", "groupBy", []),
  },
  trackedAccount: { findMany: recorder("trackedAccount", "findMany", []) },
  trackedAccountSnapshot: {
    findMany: recorder("trackedAccountSnapshot", "findMany", []),
    findFirst: recorder("trackedAccountSnapshot", "findFirst", null),
  },
  scoutSnapshot: { findMany: recorder("scoutSnapshot", "findMany", []) },
  trackedPostSnapshot: { findMany: recorder("trackedPostSnapshot", "findMany", []) },
};

vi.mock("@/lib/prisma", () => ({ prisma }));

// One account per two posts, so BOTH the post count and the account count scale with n —
// a per-account query is just as fatal as a per-post one and this must catch either.
function fakeTrackedPosts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `post-${i}`,
    campaignId: "campaign-1",
    accountId: `account-${Math.floor(i / 2)}`,
    platform: "instagram" as const,
    url: `https://www.instagram.com/p/code${i}/`,
    postKey: `code${i}`,
    mediaType: "reel",
    caption: `Post ${i}`,
    postedAt: new Date("2026-08-10T00:00:00Z"),
    addedAt: new Date("2026-08-11T00:00:00Z"),
    isActive: true,
    lastScrapedAt: new Date("2026-08-12T00:00:00Z"),
    lastError: null,
    curLikes: 100 + i,
    curComments: 10 + i,
    curShares: null,
    curViews: 5000 + i,
    prevLikes: 90 + i,
    prevComments: 8 + i,
    prevViews: 4000 + i,
  }));
}

function fakeAccounts(n: number) {
  return Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({
    id: `account-${i}`,
    platform: "instagram" as const,
    handle: `creator${i}`,
    displayName: `Creator ${i}`,
    accountKey: `instagram:creator${i}`,
    firstSeenAt: new Date("2026-08-01T00:00:00Z"),
    scoutCandidateId: `scout-${i}`,
  }));
}

function fakeAccountSnapshots(n: number) {
  return Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({
    accountId: `account-${i}`,
    followers: 10000 + i,
    followersAvailable: true,
    capturedAt: new Date("2026-08-12T00:00:00Z"),
  }));
}

function fakeScoutSnapshots(n: number) {
  return Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({
    candidateId: `scout-${i}`,
    engagementRatePct: 3.5,
    scrapedAt: new Date("2026-08-01T00:00:00Z"),
  }));
}

async function countWith(n: number, run: () => Promise<unknown>): Promise<number> {
  calls = [];
  prisma.trackedPost.findMany.mockImplementation(async () => {
    calls.push({ model: "trackedPost", op: "findMany" });
    return fakeTrackedPosts(n);
  });
  prisma.trackedAccount.findMany.mockImplementation(async () => {
    calls.push({ model: "trackedAccount", op: "findMany" });
    return fakeAccounts(n);
  });
  prisma.trackedAccountSnapshot.findMany.mockImplementation(async () => {
    calls.push({ model: "trackedAccountSnapshot", op: "findMany" });
    return fakeAccountSnapshots(n);
  });
  prisma.scoutSnapshot.findMany.mockImplementation(async () => {
    calls.push({ model: "scoutSnapshot", op: "findMany" });
    return fakeScoutSnapshots(n);
  });
  await run();
  return calls.length;
}

describe("tracked posts query count", () => {
  beforeEach(() => {
    calls = [];
  });

  it("the campaign tracking view does not query per post or per account", async () => {
    const { getCampaignTracking } = await import("./trackedPosts");

    const one = await countWith(1, () => getCampaignTracking("campaign-1"));
    const forty = await countWith(40, () => getCampaignTracking("campaign-1"));

    expect(forty).toBe(one);

    // Guards the guard: if getCampaignTracking ever short-circuits (a null campaign, an
    // early return), both counts collapse to the same small number and the assertion above
    // passes while testing nothing. These pin that the full read path really ran.
    expect(one).toBeGreaterThan(0);
    expect(new Set(calls.map((c) => c.model))).toEqual(
      new Set(["campaign", "trackedPost", "trackedAccount", "trackedAccountSnapshot", "scoutSnapshot"]),
    );
  });

  // The specific mistake this guards against: reaching for findFirst to get "the latest
  // snapshot for this account" inside a loop. It reads naturally and is one query per row.
  it("never uses findFirst for the latest account snapshot", async () => {
    const { getCampaignTracking } = await import("./trackedPosts");
    await countWith(40, () => getCampaignTracking("campaign-1"));

    expect(calls.filter((c) => c.op === "findFirst")).toHaveLength(0);
  });

  // The grid renders every card from the denormalized cur*/prev* columns. If a card ever
  // starts reading its own history, this fires.
  it("does not read the snapshot history table to render the grid", async () => {
    const { getCampaignTracking } = await import("./trackedPosts");
    await countWith(40, () => getCampaignTracking("campaign-1"));

    expect(calls.filter((c) => c.model === "trackedPostSnapshot")).toHaveLength(0);
  });

  it("the tracker index does not query per campaign", async () => {
    const { getTrackedCampaigns } = await import("./trackedPosts");

    calls = [];
    prisma.trackedPost.groupBy.mockImplementation(async () => {
      calls.push({ model: "trackedPost", op: "groupBy" });
      return [{ campaignId: "campaign-1", _count: { _all: 3 } }];
    });
    prisma.campaign.findMany.mockImplementation(async () => {
      calls.push({ model: "campaign", op: "findMany" });
      return Array.from({ length: 40 }, (_, i) => ({
        id: `campaign-${i}`,
        name: `Campaign ${i}`,
        status: "live",
      }));
    });
    await getTrackedCampaigns();

    expect(calls).toHaveLength(2);
  });
});

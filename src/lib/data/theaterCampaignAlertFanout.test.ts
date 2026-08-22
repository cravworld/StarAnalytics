import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One scan must produce ONE email, however many theaters it flags — while still writing
 * one Alert row per theater.
 *
 * Both halves matter and they pull in opposite directions:
 *
 *   - The send used to sit inside the per-theater loop. A 32-theater scan sent 32 emails,
 *     and at full Kerala coverage (~178 theaters) it would be far worse. That is the bug
 *     this file exists for.
 *   - The obvious fix — collapse to a single `bms_demand_digest:<campaign>` Alert row —
 *     would quietly widen dedup from per-theater to per-campaign. The row IS the dedup
 *     key (see alertDedupMinutes): a theater going quiet at 14:00 would then be suppressed
 *     because a *different* theater alerted at 13:00, and would never be reported at all.
 *
 * So asserting "one send" alone would pass for a change that breaks suppression. The row
 * count is asserted alongside it deliberately.
 */

interface AlertRow {
  id: string;
  type: string;
  message: string;
  createdAt: Date;
  deliveredAt: Date | null;
}

let created: AlertRow[] = [];
let sends: { type: string; subject?: string; message: string; html?: string }[] = [];
let recentTypes = new Set<string>();
let nextId = 0;

function theaterRow(i: number) {
  return {
    id: `screening-${i}`,
    theaterId: `theater-${i}`,
    campaignId: "campaign-1",
    showDateTime: new Date("2026-08-23T12:00:00Z"),
    priceBands: ["120"],
    language: "Malayalam",
    format: "2D",
    disappearedAt: null,
    lastSeenAt: new Date("2026-08-22T09:00:00Z"),
    theater: {
      id: `theater-${i}`,
      venueCode: `V${i}`,
      name: `Theatre ${i}`,
      cityCode: "KOCH",
      cityName: "Kochi",
      chainCode: null,
    },
  };
}

let screenings: ReturnType<typeof theaterRow>[] = [];

const prisma = {
  theaterCampaign: {
    findUnique: vi.fn(async () => ({
      id: "campaign-1",
      name: "Empuraan Kerala",
      movieName: "Empuraan",
      status: "active",
      bmsEventCode: "ET001",
      targetCityCodes: ["KOCH"],
      scanIntervalMinutes: 90,
      wideOpenAlertPct: 60,
      minShowsForAlert: 3,
      screeningStartDate: null,
      screeningEndDate: null,
    })),
  },
  bmsScanRun: { findFirst: vi.fn(async () => null) },
  screening: { findMany: vi.fn(async () => screenings) },
  availabilitySnapshot: {
    findMany: vi.fn(async () =>
      screenings.map((s) => ({ screeningId: s.id, demandLevel: "wide_open", confidence: "high" })),
    ),
    groupBy: vi.fn(async () => screenings.map((s) => ({ screeningId: s.id, _count: { _all: 2 } }))),
  },
  alert: {
    findFirst: vi.fn(async ({ where }: { where: { type: string } }) =>
      recentTypes.has(where.type) ? { id: "existing" } : null,
    ),
    create: vi.fn(async ({ data }: { data: { type: string; message: string } }) => {
      const row: AlertRow = {
        id: `alert-${nextId++}`,
        type: data.type,
        message: data.message,
        createdAt: new Date("2026-08-22T09:00:00Z"),
        deliveredAt: null,
      };
      created.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { deliveredAt: Date } }) => {
      for (const row of created) {
        if (where.id.in.includes(row.id)) row.deliveredAt = data.deliveredAt;
      }
      return { count: where.id.in.length };
    }),
    update: vi.fn(async () => ({})),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma }));

// Scoring has its own tests; here every theater is forced into the "push here" band so the
// assertions are about delivery fan-out, not about what qualifies as urgent.
vi.mock("@/lib/bookmyshow/scoring", () => ({
  scoreTheater: () => ({
    score: 90,
    band: "high",
    reasons: ["Every show is wide open."],
    confidence: "high",
    eligibleShows: 10,
    wideOpenShows: 8,
    imminentWideOpenShows: 4,
    movement: null,
    recommendation: "Push here.",
  }),
}));

vi.mock("@/lib/providers", () => ({
  getNotifierChannel: () => "email",
  getNotifierProvider: () => ({
    send: vi.fn(async (alert: { type: string; subject?: string; message: string; html?: string }) => {
      sends.push(alert);
    }),
  }),
}));

const { raiseCampaignAlerts } = await import("./theaterCampaigns");

beforeEach(() => {
  created = [];
  sends = [];
  recentTypes = new Set();
  nextId = 0;
  vi.clearAllMocks();
});

const NOW = new Date("2026-08-22T09:00:00Z");

describe("raiseCampaignAlerts delivery fan-out", () => {
  it("sends ONE email for a scan that flags three theaters, but writes three Alert rows", () => {
    screenings = [theaterRow(1), theaterRow(2), theaterRow(3)];

    return raiseCampaignAlerts("campaign-1", { now: NOW }).then((res) => {
      expect(res.raised).toBe(3);
      // The regression this file guards.
      expect(sends).toHaveLength(1);
      // ...and the dedup keys that must survive it.
      expect(created).toHaveLength(3);
      expect(created.map((a) => a.type).sort()).toEqual([
        "bms_demand:campaign-1:theater-1",
        "bms_demand:campaign-1:theater-2",
        "bms_demand:campaign-1:theater-3",
      ]);
    });
  });

  it("still sends one email at the volume that caused the complaint", async () => {
    screenings = Array.from({ length: 32 }, (_, i) => theaterRow(i));
    const res = await raiseCampaignAlerts("campaign-1", { now: NOW });
    expect(res.raised).toBe(32);
    expect(sends).toHaveLength(1);
    expect(created).toHaveLength(32);
  });

  it("names every flagged theater in the one email it sends", async () => {
    screenings = [theaterRow(1), theaterRow(2), theaterRow(3)];
    await raiseCampaignAlerts("campaign-1", { now: NOW });
    for (const name of ["Theatre 1", "Theatre 2", "Theatre 3"]) {
      expect(sends[0].message).toContain(name);
      expect(sends[0].html).toContain(name);
    }
  });

  it("suppresses a theater alerted inside the dedup window, per theater and not per campaign", async () => {
    screenings = [theaterRow(1), theaterRow(2), theaterRow(3)];
    // Theater 2 was already reported recently; 1 and 3 were not.
    recentTypes.add("bms_demand:campaign-1:theater-2");

    const res = await raiseCampaignAlerts("campaign-1", { now: NOW });
    expect(res.suppressed).toBe(1);
    expect(res.raised).toBe(2);
    expect(sends).toHaveLength(1);
    expect(sends[0].message).not.toContain("Theatre 2");
    expect(sends[0].message).toContain("Theatre 1");
    expect(sends[0].message).toContain("Theatre 3");
  });

  it("sends nothing at all when every flagged theater is inside the dedup window", async () => {
    screenings = [theaterRow(1), theaterRow(2)];
    recentTypes.add("bms_demand:campaign-1:theater-1");
    recentTypes.add("bms_demand:campaign-1:theater-2");

    const res = await raiseCampaignAlerts("campaign-1", { now: NOW });
    expect(res.raised).toBe(0);
    // An "everything is quiet, nothing new" email every 90 minutes is the same failure in
    // a smaller costume.
    expect(sends).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("stamps deliveredAt on every row the one send covered", async () => {
    screenings = [theaterRow(1), theaterRow(2), theaterRow(3)];
    await raiseCampaignAlerts("campaign-1", { now: NOW });
    // One delivery covers the whole batch — none of the rows may be left looking undelivered.
    expect(created.every((a) => a.deliveredAt !== null)).toBe(true);
    expect(prisma.alert.updateMany).toHaveBeenCalledTimes(1);
  });

  it("gives the digest a subject naming the movie, not a raw alert type", async () => {
    screenings = [theaterRow(1), theaterRow(2)];
    await raiseCampaignAlerts("campaign-1", { now: NOW });
    expect(sends[0].subject).toContain("Empuraan");
    expect(sends[0].subject).not.toContain("bms_demand");
  });
});

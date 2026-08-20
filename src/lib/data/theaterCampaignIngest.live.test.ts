// OPT-IN database integration test for the ingest pipeline. Does NOT run by default.
//
//   RUN_BMS_DB_TEST=true DOTENV_CONFIG_PATH=.env.local npx vitest run \
//     src/lib/data/theaterCampaignIngest.live.test.ts
//
// It writes to whatever DATABASE_URL points at, using the MOCK provider — no BookMyShow
// traffic, no Apify spend — and deletes the campaign it created. It exists because the two
// worst bugs this pipeline has had were both invisible to unit tests:
//
//   1. Per-row upserts inside one interactive transaction took the FIRST city past Prisma's
//      5s limit. The transaction rolled back, the throw escaped the scan loop, and a
//      Kerala-wide scan wrote nothing while its run row sat in `running` forever.
//   2. The dangerous case is the SECOND scan, not the first. If a rewrite stops refreshing
//      lastSeenAt, scan #1 still looks perfect — and scan #2 marks the entire slate as
//      disappeared, which reads downstream as every theater pulling the film.
//
// So this runs the same scan twice and checks that nothing moved.

import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { runCampaignScan } from "@/lib/data/theaterCampaigns";

const ENABLED = process.env.RUN_BMS_DB_TEST === "true" && Boolean(process.env.DATABASE_URL);

let campaignId: string | null = null;
/** Theater ids that existed BEFORE this test ran. Anything outside this set is ours. */
let preExistingTheaterIds: Set<string> = new Set();

afterAll(async () => {
  // Screenings, snapshots, runs and city results cascade from the campaign. Theaters do
  // NOT — they are not campaign-scoped — so they have to be removed explicitly.
  //
  // An earlier version of this comment claimed they were safe to leave because "a
  // production scan would create the same ones". That was wrong, and it cost a real
  // investigation: mock venue codes are synthetic (`KOCH01`), so they never merge with a
  // real BookMyShow venue. Two runs of this test left 178 permanent phantom theaters in the
  // database, sitting alongside 27 real ones with no screenings attached.
  //
  // Scoped by ID to theaters that did not exist before this test started, and that still
  // carry no screenings. "Screening-less" alone is NOT a safe filter here: this runs
  // against DATABASE_URL, which is production, and a real venue whose theater row was
  // written by a partial run whose screening write failed would match it too.
  if (campaignId) {
    await prisma.theaterCampaign.delete({ where: { id: campaignId } }).catch(() => {});
    const ours = await prisma.theater.findMany({
      where: { screenings: { none: {} }, id: { notIn: [...preExistingTheaterIds] } },
      select: { id: true },
    });
    if (ours.length > 0) {
      await prisma.theater
        .deleteMany({ where: { id: { in: ours.map((t) => t.id) } } })
        .catch(() => {});
    }
  }
  await prisma.$disconnect();
});

describe.skipIf(!ENABLED)("ingest against a real database (opt-in)", () => {
  const TIMEOUT_MS = 5 * 60 * 1000;

  it(
    "writes a full Kerala scan, then repeats it without disturbing what it wrote",
    async () => {
      preExistingTheaterIds = new Set(
        (await prisma.theater.findMany({ select: { id: true } })).map((t) => t.id),
      );

      // DATA_MODE_BOOKMYSHOW is left alone deliberately: if a run ever reports a provider
      // other than "mock" this test is sending real traffic and must fail, not adapt.
      const campaign = await prisma.theaterCampaign.create({
        data: {
          name: `ingest-test-${process.pid}`,
          movieName: "Bethlehem Kudumba Unit",
          bmsEventCode: "et00502829",
          targetCityCodes: [],
          scanIntervalMinutes: 90,
          wideOpenAlertPct: 80,
          minShowsForAlert: 3,
        },
      });
      campaignId = campaign.id;

      const startedAt = Date.now();
      const first = await runCampaignScan(campaign.id, { horizonDays: 1 });
      const firstMs = Date.now() - startedAt;

      expect(first.status, `scan errored: ${first.error ?? "no message"}`).not.toBe("error");
      expect(first.citiesSucceeded).toBeGreaterThan(0);
      expect(first.screeningsStored).toBeGreaterThan(0);
      expect(first.snapshotsStored).toBeGreaterThan(0);

      // Every city read must be a city stored. A city page that parsed but could not be
      // written is the failure mode that produced a 30-city scan with one row.
      const firstRun = await prisma.bmsScanRun.findUniqueOrThrow({ where: { id: first.scanRunId } });
      expect(firstRun.provider).toBe("mock");
      expect(firstRun.status).not.toBe("running");
      const failedCities = await prisma.bmsScanCityResult.count({
        where: { scanRunId: first.scanRunId, status: { not: "ok" } },
      });
      expect(failedCities).toBe(0);

      // Not a benchmark — a smoke alarm. The per-row version needed roughly this long for a
      // SINGLE city, so anything near it means the bulk writes have regressed.
      expect(firstMs).toBeLessThan(120_000);

      const screeningsAfterFirst = await prisma.screening.count({ where: { campaignId: campaign.id } });
      expect(screeningsAfterFirst).toBe(first.screeningsStored);

      const second = await runCampaignScan(campaign.id, { horizonDays: 1 });
      expect(second.status).not.toBe("error");

      // The whole point of the second run: the same shows, seen again.
      const screeningsAfterSecond = await prisma.screening.count({ where: { campaignId: campaign.id } });
      expect(screeningsAfterSecond).toBe(screeningsAfterFirst);

      const wronglyDisappeared = await prisma.screening.count({
        where: { campaignId: campaign.id, disappearedAt: { not: null } },
      });
      expect(
        wronglyDisappeared,
        "the second scan marked shows as pulled — lastSeenAt is not being refreshed",
      ).toBe(0);

      // Two observations per show, one per run: the history grows, the slate does not.
      const snapshots = await prisma.availabilitySnapshot.count({
        where: { screening: { campaignId: campaign.id } },
      });
      expect(snapshots).toBe(first.snapshotsStored + second.snapshotsStored);

      // And one observation per show per run, which is the idempotency guarantee the
      // unique constraint exists to make.
      expect(second.snapshotsStored).toBe(screeningsAfterSecond);
    },
    TIMEOUT_MS,
  );
});

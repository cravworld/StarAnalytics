import "server-only";

import { prisma } from "@/lib/prisma";
import { readDemand, type DemandLevel } from "@/lib/bookmyshow/demand";
import { istDateOnly, normalizeCityPage } from "@/lib/bookmyshow/normalize";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";
import { getBookMyShowProvider, isBookMyShowLive } from "@/lib/bookmyshow/providers";
import { scoreTheater, type ShowSignal, type TheaterPriority } from "@/lib/bookmyshow/scoring";
import { resolveRegions } from "@/lib/bookmyshow/urls";
import type { BmsScrapeItem, NormalizedCityResult } from "@/lib/bookmyshow/types";

// Data layer for Theater Campaign Intelligence.
//
// The ingest half is where most of the care lives. Three rules it exists to enforce, all
// of which come straight from what BookMyShow's data can and cannot support:
//
//   1. A failed city is recorded as failed, never as a city with no demand. This is the
//      difference between "we could not read Palakkad" and "nothing is selling in
//      Palakkad" — one is a retry, the other moves a campaign budget.
//   2. Repeated scans are idempotent, enforced by unique constraints rather than by
//      remembering to check. A double-run cannot inflate a trend line.
//   3. Nothing is ever derived that implies a seat count. See BOOKMYSHOW-FEASIBILITY.md.

const SCAN_LOG = "[bms-scan]";

export interface CreateCampaignInput {
  name: string;
  movieName: string;
  bmsEventCode: string;
  bmsSourceUrl?: string | null;
  targetCityCodes: string[];
  screeningStartDate?: Date | null;
  screeningEndDate?: Date | null;
  scanIntervalMinutes: number;
  wideOpenAlertPct: number;
  minShowsForAlert: number;
}

export async function createTheaterCampaign(input: CreateCampaignInput) {
  return prisma.theaterCampaign.create({
    data: {
      name: input.name,
      movieName: input.movieName,
      bmsEventCode: input.bmsEventCode,
      bmsSourceUrl: input.bmsSourceUrl ?? null,
      targetCityCodes: input.targetCityCodes,
      screeningStartDate: input.screeningStartDate ?? null,
      screeningEndDate: input.screeningEndDate ?? null,
      scanIntervalMinutes: input.scanIntervalMinutes,
      wideOpenAlertPct: input.wideOpenAlertPct,
      minShowsForAlert: input.minShowsForAlert,
    },
  });
}

export async function updateTheaterCampaign(id: string, input: Partial<CreateCampaignInput>) {
  return prisma.theaterCampaign.update({ where: { id }, data: { ...input } });
}

export async function listTheaterCampaigns() {
  const campaigns = await prisma.theaterCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      scanRuns: { orderBy: { startedAt: "desc" }, take: 1 },
      _count: { select: { screenings: true } },
    },
  });

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    movieName: c.movieName,
    status: c.status,
    cityCount: c.targetCityCodes.length || resolveRegions([]).length,
    screeningCount: c._count.screenings,
    lastScan: c.scanRuns[0]
      ? {
          id: c.scanRuns[0].id,
          status: c.scanRuns[0].status,
          provider: c.scanRuns[0].provider,
          startedAt: c.scanRuns[0].startedAt,
          finishedAt: c.scanRuns[0].finishedAt,
          error: c.scanRuns[0].error,
        }
      : null,
  }));
}

/**
 * The dates a scan should cover, clamped to the campaign's screening window.
 *
 * Anchored on the IST calendar day, not the UTC one. Those diverge for 5.5 hours every
 * evening: a scan running at 19:00 UTC is already on the next day in India, and a UTC
 * anchor would spend its first slot re-scanning a day that has finished there while
 * missing the far end of the horizon.
 */
export function scanDates(campaign: {
  screeningStartDate: Date | null;
  screeningEndDate: Date | null;
}, now: Date, horizonDays: number): Date[] {
  const dates: Date[] = [];
  const start = istDateOnly(now);
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    if (campaign.screeningStartDate && d < midnightUtc(campaign.screeningStartDate)) continue;
    if (campaign.screeningEndDate && d > midnightUtc(campaign.screeningEndDate)) continue;
    dates.push(d);
  }
  return dates;
}

function midnightUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Slug used in the BookMyShow URL path. Cosmetic, but the canonical form carries it. */
export function movieSlugFor(movieName: string): string {
  return movieName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface ScanResult {
  scanRunId: string;
  status: "done" | "partial" | "error";
  citiesRequested: number;
  citiesSucceeded: number;
  theatersStored: number;
  screeningsStored: number;
  snapshotsStored: number;
  recordsSkipped: number;
  recordsUnmapped: number;
  error: string | null;
}

/**
 * Run one scan of one campaign, end to end.
 *
 * Synchronous by design for the MVP: the provider does its own waiting and the caller is
 * either a cron with a long maxDuration or a manual trigger. If a Kerala-wide scan turns
 * out to exceed the wait budget, the migration path is the one ScoutRun already models —
 * persist the Apify run id and let a polling cron ingest it — which is why BmsScanRun
 * already carries apifyRunId and datasetId columns it does not strictly need yet.
 */
export async function runCampaignScan(
  campaignId: string,
  opts: { horizonDays?: number; now?: Date } = {},
): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const horizonDays = opts.horizonDays ?? Number(process.env.BOOKMYSHOW_SCAN_HORIZON_DAYS ?? 3);

  const campaign = await prisma.theaterCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error(`Theater campaign ${campaignId} not found`);

  const regions = resolveRegions(campaign.targetCityCodes);
  const dates = scanDates(campaign, now, horizonDays);
  const provider = getBookMyShowProvider();

  const scanRun = await prisma.bmsScanRun.create({
    data: {
      campaignId,
      status: "running",
      provider: provider.name,
      citiesRequested: regions.length * Math.max(dates.length, 1),
      startedAt: now,
    },
  });

  console.log(
    `${SCAN_LOG} run started campaign=${campaignId} provider=${provider.name} cities=${regions.length} dates=${dates.length}`,
  );

  if (regions.length === 0 || dates.length === 0) {
    // Not an error: a campaign whose screening window has passed simply has nothing to
    // look at. Recording it as `done` with zero work keeps the distinction from a failure.
    const empty = await prisma.bmsScanRun.update({
      where: { id: scanRun.id },
      data: { status: "done", finishedAt: new Date() },
    });
    return {
      scanRunId: empty.id,
      status: "done",
      citiesRequested: 0,
      citiesSucceeded: 0,
      theatersStored: 0,
      screeningsStored: 0,
      snapshotsStored: 0,
      recordsSkipped: 0,
      recordsUnmapped: 0,
      error: null,
    };
  }

  let items;
  try {
    items = await provider.fetchShowtimes({
      eventCode: campaign.bmsEventCode,
      movieSlug: movieSlugFor(campaign.movieName),
      regionCodes: regions.map((r) => r.code),
      dates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${SCAN_LOG} run failed campaign=${campaignId}: ${message}`);
    await prisma.bmsScanRun.update({
      where: { id: scanRun.id },
      data: { status: "error", finishedAt: new Date(), error: message },
    });
    // Deliberately NOT swallowed into a zero-result "done". A provider failure that
    // recorded itself as a completed scan with no shows would read downstream as every
    // theater suddenly having no demand — the single worst false signal this system could
    // emit.
    return {
      scanRunId: scanRun.id,
      status: "error",
      citiesRequested: regions.length * dates.length,
      citiesSucceeded: 0,
      theatersStored: 0,
      screeningsStored: 0,
      snapshotsStored: 0,
      recordsSkipped: 0,
      recordsUnmapped: 0,
      error: message,
    };
  }

  return ingestScrapeItems({ campaignId, scanRunId: scanRun.id, items, now, requested: regions.length * dates.length });
}

/**
 * The ingest half, shared by every way data can arrive.
 *
 * Split out from runCampaignScan so the local-capture path (scripts/bms-capture.mjs, which
 * drives a real browser and POSTs its findings) lands through EXACTLY the same
 * normalization, region assertion, idempotency and disappearance logic as a provider-driven
 * scan. Two ingest paths that drift apart would be two different definitions of the truth.
 */
export async function ingestScrapeItems(args: {
  campaignId: string;
  scanRunId: string;
  items: BmsScrapeItem[];
  now: Date;
  requested: number;
}): Promise<ScanResult> {
  const { campaignId, scanRunId, items, now } = args;

  console.log(`${SCAN_LOG} items received campaign=${campaignId} count=${items.length}`);

  let theatersStored = 0;
  let screeningsStored = 0;
  let snapshotsStored = 0;
  let recordsSkipped = 0;
  let recordsUnmapped = 0;
  let citiesSucceeded = 0;
  const succeededCityCodes = new Set<string>();
  const succeededDates = new Set<string>();

  for (const item of items) {
    const normalized = normalizeCityPage(item);
    recordsSkipped += normalized.skipped.length;

    // The date code comes off an Apify dataset item, so it is untrusted input. A malformed
    // one must fail THIS city, not throw out of the loop and abandon the whole scan —
    // degrading to partial results is the property the entire pipeline is built around.
    const showDate = dateFromCode(normalized.showDateCode);
    if (!showDate) {
      console.warn(
        `${SCAN_LOG} unusable show date campaign=${campaignId} city=${normalized.cityCode} code=${String(normalized.showDateCode)}`,
      );
      continue;
    }

    await prisma.bmsScanCityResult.upsert({
      where: {
        scanRunId_cityCode_showDate: {
          scanRunId,
          cityCode: normalized.cityCode,
          showDate,
        },
      },
      create: {
        scanRunId,
        cityCode: normalized.cityCode,
        showDate,
        status: normalized.status,
        returnedCityCode: normalized.returnedCityCode,
        venueCount: normalized.theaters.length,
        showCount: normalized.screenings.length,
        error: normalized.error,
      },
      update: {
        status: normalized.status,
        returnedCityCode: normalized.returnedCityCode,
        venueCount: normalized.theaters.length,
        showCount: normalized.screenings.length,
        error: normalized.error,
      },
    });

    if (normalized.status !== "ok") {
      console.warn(
        `${SCAN_LOG} city not usable campaign=${campaignId} city=${normalized.cityCode} status=${normalized.status} reason=${normalized.error ?? "unknown"}`,
      );
      continue;
    }

    citiesSucceeded++;
    succeededCityCodes.add(normalized.cityCode);
    succeededDates.add(normalized.showDateCode);

    const stored = await ingestCityResult(campaignId, scanRunId, normalized);
    theatersStored += stored.theaters;
    screeningsStored += stored.screenings;
    snapshotsStored += stored.snapshots;
    recordsUnmapped += stored.unmapped;
  }

  const disappeared = await markDisappeared({
    campaignId,
    scanStartedAt: now,
    cityCodes: [...succeededCityCodes],
    showDates: [...succeededDates].map(dateFromCode).filter((d): d is Date => d !== null),
  });

  const status: ScanResult["status"] =
    citiesSucceeded === 0 ? "error" : citiesSucceeded < items.length ? "partial" : "done";

  await prisma.bmsScanRun.update({
    where: { id: scanRunId },
    data: {
      status,
      finishedAt: new Date(),
      citiesSucceeded,
      itemsReceived: items.length,
      theatersStored,
      screeningsStored,
      snapshotsStored,
      recordsSkipped,
      recordsUnmapped,
      error: citiesSucceeded === 0 ? "No city page could be read in this scan" : null,
    },
  });

  console.log(
    `${SCAN_LOG} run finished campaign=${campaignId} status=${status} cities=${citiesSucceeded}/${items.length} theaters=${theatersStored} screenings=${screeningsStored} snapshots=${snapshotsStored} skipped=${recordsSkipped} unmapped=${recordsUnmapped} disappeared=${disappeared}`,
  );

  if (recordsUnmapped > 0) {
    // Loud on purpose. This means BookMyShow returned an availStatus this codebase has
    // never seen, which invalidates the demand vocabulary the whole ranking rests on.
    console.error(
      `${SCAN_LOG} ${recordsUnmapped} shows carried an UNRECOGNISED availStatus (campaign=${campaignId}). Demand levels may be wrong — review src/lib/bookmyshow/demand.ts before trusting this ranking.`,
    );
  }

  return {
    scanRunId,
    status,
    citiesRequested: args.requested,
    citiesSucceeded,
    theatersStored,
    screeningsStored,
    snapshotsStored,
    recordsSkipped,
    recordsUnmapped,
    error: null,
  };
}

/**
 * Persist one successfully-read city page.
 *
 * One transaction per city rather than one for the whole scan: a Kerala-wide scan touches
 * thousands of rows, and a single transaction that size holds locks long enough to matter
 * on a pooled Supabase connection. Per-city is also the right failure granularity — it
 * matches how the results are reported.
 */
async function ingestCityResult(
  campaignId: string,
  scanRunId: string,
  normalized: NormalizedCityResult,
): Promise<{ theaters: number; screenings: number; snapshots: number; unmapped: number }> {
  return prisma.$transaction(async (tx) => {
    const theaterIdByVenue = new Map<string, string>();
    let unmapped = 0;

    for (const t of normalized.theaters) {
      const theater = await tx.theater.upsert({
        where: { source_venueCode: { source: "bookmyshow", venueCode: t.venueCode } },
        create: {
          source: "bookmyshow",
          venueCode: t.venueCode,
          name: t.name,
          cityCode: t.cityCode,
          cityName: t.cityName,
          chainCode: t.chainCode,
        },
        // cityCode/cityName are NOT updated: they record where the venue was first seen,
        // and BookMyShow lists the same venue under several adjacent regions. Rewriting
        // them each scan would make a theater appear to move between districts.
        update: { name: t.name, chainCode: t.chainCode, lastSeenAt: new Date() },
      });
      theaterIdByVenue.set(t.venueCode, theater.id);
    }

    let snapshots = 0;
    for (const s of normalized.screenings) {
      const theaterId = theaterIdByVenue.get(s.venueCode);
      if (!theaterId) continue;

      const screening = await tx.screening.upsert({
        where: {
          campaignId_bmsSessionId_showDate: {
            campaignId,
            bmsSessionId: s.bmsSessionId,
            showDate: s.showDate,
          },
        },
        create: {
          campaignId,
          theaterId,
          bmsSessionId: s.bmsSessionId,
          showDate: s.showDate,
          showDateTime: s.showDateTime,
          cutOffAt: s.cutOffAt,
          language: s.language,
          format: s.format,
          priceBands: s.priceBands,
        },
        update: {
          showDateTime: s.showDateTime,
          cutOffAt: s.cutOffAt,
          language: s.language,
          format: s.format,
          priceBands: s.priceBands,
          lastSeenAt: new Date(),
          // A show that reappears after vanishing is no longer gone. Without this a
          // temporary blip would leave it permanently marked as disappeared.
          disappearedAt: null,
        },
      });

      const reading = readDemand(s.availStatus);
      if (reading.unmapped) unmapped++;
      await tx.availabilitySnapshot.upsert({
        // The idempotency guarantee: one observation per show per scan run, enforced by
        // the database. A retried scan updates in place instead of doubling the history.
        where: { screeningId_scanRunId: { screeningId: screening.id, scanRunId } },
        create: {
          screeningId: screening.id,
          scanRunId,
          availStatus: s.availStatus,
          demandLevel: reading.level,
          styleId: s.styleId,
          sourceLabel: s.sourceLabel,
          confidence: reading.confidence,
        },
        update: {
          availStatus: s.availStatus,
          demandLevel: reading.level,
          styleId: s.styleId,
          sourceLabel: s.sourceLabel,
          confidence: reading.confidence,
        },
      });
      snapshots++;
    }

    return {
      theaters: normalized.theaters.length,
      screenings: normalized.screenings.length,
      snapshots,
      unmapped,
    };
  });
}

/**
 * Mark shows that stopped appearing.
 *
 * Scoped to cities AND dates that were read SUCCESSFULLY in this scan. That scoping is the
 * whole point: a show missing from a page we failed to load has not disappeared, we simply
 * did not look. Recording it as gone would quietly shrink a theater's slate and make it
 * look like the exhibitor pulled the film.
 */
async function markDisappeared(opts: {
  campaignId: string;
  scanStartedAt: Date;
  cityCodes: string[];
  showDates: Date[];
}): Promise<number> {
  if (opts.cityCodes.length === 0 || opts.showDates.length === 0) return 0;
  const result = await prisma.screening.updateMany({
    where: {
      campaignId: opts.campaignId,
      showDate: { in: opts.showDates },
      disappearedAt: null,
      lastSeenAt: { lt: opts.scanStartedAt },
      theater: { cityCode: { in: opts.cityCodes } },
    },
    data: { disappearedAt: new Date() },
  });
  return result.count;
}

/**
 * Returns null for anything that is not a YYYYMMDD code.
 *
 * Null rather than a `new Date(0)` fallback on purpose: a 1970 date written into a scan
 * result is a plausible-looking wrong value that would sit in the table forever, which is
 * worse than an explicitly skipped city.
 */
function dateFromCode(code: string | null | undefined): Date | null {
  if (typeof code !== "string") return null;
  const m = code.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface TheaterRow {
  theaterId: string;
  venueCode: string;
  name: string;
  cityCode: string;
  cityName: string;
  chainCode: string | null;
  priority: TheaterPriority;
  nextShowAt: Date | null;
  priceBands: string[];
  lastScannedAt: Date | null;
  languages: string[];
  formats: string[];
}

export interface CampaignDetail {
  campaign: {
    id: string;
    name: string;
    movieName: string;
    status: string;
    bmsEventCode: string;
    targetCityCodes: string[];
    scanIntervalMinutes: number;
    wideOpenAlertPct: number;
    minShowsForAlert: number;
    screeningStartDate: Date | null;
    screeningEndDate: Date | null;
  };
  lastScan: {
    id: string;
    status: string;
    provider: string;
    startedAt: Date;
    finishedAt: Date | null;
    error: string | null;
    citiesRequested: number;
    citiesSucceeded: number;
    recordsSkipped: number;
    recordsUnmapped: number;
    failedCities: { cityCode: string; status: string; error: string | null }[];
  } | null;
  theaters: TheaterRow[];
  totals: {
    theaters: number;
    shows: number;
    byLevel: Record<DemandLevel, number>;
  };
  isLive: boolean;
}

/**
 * Everything the campaign detail page renders.
 *
 * Reads only the LATEST snapshot per screening plus the earliest one, which is all the
 * scoring needs — pulling the full history for every show in Kerala would be a very large
 * query to render one table.
 */
export async function getTheaterCampaignDetail(
  campaignId: string,
  opts: { now?: Date } = {},
): Promise<CampaignDetail | null> {
  const now = opts.now ?? new Date();
  const campaign = await prisma.theaterCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return null;

  const [lastScan, screenings] = await Promise.all([
    prisma.bmsScanRun.findFirst({
      where: { campaignId },
      orderBy: { startedAt: "desc" },
      include: { cityResults: { where: { status: { not: "ok" } } } },
    }),
    prisma.screening.findMany({
      where: { campaignId, disappearedAt: null, showDateTime: { gte: new Date(now.getTime() - 3_600_000) } },
      include: {
        theater: true,
      },
      orderBy: { showDateTime: "asc" },
    }),
  ]);

  // Snapshots are fetched in three BOUNDED queries rather than as a nested include.
  //
  // The include version pulled every snapshot for every show — this table is append-only
  // and grows by one row per show per scan, so at a 90-minute cadence across Kerala it
  // reaches tens of thousands of rows within days, all to render one table that only needs
  // three facts per show: the latest reading, the first one, and how many there are.
  // `distinct` on an ordered findMany gives the first two in one row per screening each.
  const screeningIds = screenings.map((s) => s.id);
  const [latestSnaps, firstSnaps, counts] = await Promise.all([
    screeningIds.length
      ? prisma.availabilitySnapshot.findMany({
          where: { screeningId: { in: screeningIds } },
          orderBy: [{ screeningId: "asc" }, { capturedAt: "desc" }],
          distinct: ["screeningId"],
          select: { screeningId: true, demandLevel: true, confidence: true },
        })
      : [],
    screeningIds.length
      ? prisma.availabilitySnapshot.findMany({
          where: { screeningId: { in: screeningIds } },
          orderBy: [{ screeningId: "asc" }, { capturedAt: "asc" }],
          distinct: ["screeningId"],
          select: { screeningId: true, demandLevel: true },
        })
      : [],
    screeningIds.length
      ? prisma.availabilitySnapshot.groupBy({
          by: ["screeningId"],
          where: { screeningId: { in: screeningIds } },
          _count: { _all: true },
        })
      : [],
  ]);

  const latestById = new Map(latestSnaps.map((s) => [s.screeningId, s]));
  const firstById = new Map(firstSnaps.map((s) => [s.screeningId, s]));
  const countById = new Map(counts.map((c) => [c.screeningId, c._count._all]));

  const byTheater = new Map<string, { theater: (typeof screenings)[number]["theater"]; signals: ShowSignal[]; rows: typeof screenings }>();
  const byLevel: Record<DemandLevel, number> = {
    wide_open: 0,
    filling: 0,
    limited: 0,
    unavailable: 0,
    unknown: 0,
  };

  for (const s of screenings) {
    const latest = latestById.get(s.id);
    if (!latest) continue;
    const snapshotCount = countById.get(s.id) ?? 1;
    const first = firstById.get(s.id);
    byLevel[latest.demandLevel as DemandLevel] = (byLevel[latest.demandLevel as DemandLevel] ?? 0) + 1;

    let entry = byTheater.get(s.theaterId);
    if (!entry) {
      entry = { theater: s.theater, signals: [], rows: [] as typeof screenings };
      byTheater.set(s.theaterId, entry);
    }
    entry.signals.push({
      screeningId: s.id,
      showDateTime: s.showDateTime,
      latestLevel: latest.demandLevel as DemandLevel,
      latestConfidence: latest.confidence as "high" | "low" | "none",
      firstLevel: snapshotCount > 1 && first ? (first.demandLevel as DemandLevel) : null,
      snapshotCount,
    });
    entry.rows.push(s);
  }

  const theaters: TheaterRow[] = [...byTheater.values()].map((entry) => {
    const priority = scoreTheater(entry.signals, {
      now,
      minShowsForAlert: campaign.minShowsForAlert,
      wideOpenAlertPct: campaign.wideOpenAlertPct,
    });
    const upcoming = entry.rows.filter((r) => r.showDateTime >= now);
    return {
      theaterId: entry.theater.id,
      venueCode: entry.theater.venueCode,
      name: entry.theater.name,
      cityCode: entry.theater.cityCode,
      cityName: entry.theater.cityName,
      chainCode: entry.theater.chainCode,
      priority,
      nextShowAt: upcoming[0]?.showDateTime ?? null,
      priceBands: [...new Set(entry.rows.flatMap((r) => r.priceBands))].sort(),
      lastScannedAt: entry.rows.reduce<Date | null>(
        (acc, r) => (acc === null || r.lastSeenAt > acc ? r.lastSeenAt : acc),
        null,
      ),
      languages: [...new Set(entry.rows.map((r) => r.language).filter((l): l is string => Boolean(l)))],
      formats: [...new Set(entry.rows.map((r) => r.format).filter((f): f is string => Boolean(f)))],
    };
  });

  // Worst first — that is the question the page exists to answer.
  theaters.sort((a, b) => b.priority.score - a.priority.score || a.name.localeCompare(b.name));

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      movieName: campaign.movieName,
      status: campaign.status,
      bmsEventCode: campaign.bmsEventCode,
      targetCityCodes: campaign.targetCityCodes,
      scanIntervalMinutes: campaign.scanIntervalMinutes,
      wideOpenAlertPct: campaign.wideOpenAlertPct,
      minShowsForAlert: campaign.minShowsForAlert,
      screeningStartDate: campaign.screeningStartDate,
      screeningEndDate: campaign.screeningEndDate,
    },
    lastScan: lastScan
      ? {
          id: lastScan.id,
          status: lastScan.status,
          provider: lastScan.provider,
          startedAt: lastScan.startedAt,
          finishedAt: lastScan.finishedAt,
          error: lastScan.error,
          citiesRequested: lastScan.citiesRequested,
          citiesSucceeded: lastScan.citiesSucceeded,
          recordsSkipped: lastScan.recordsSkipped,
          recordsUnmapped: lastScan.recordsUnmapped,
          failedCities: lastScan.cityResults.map((c) => ({
            cityCode: c.cityCode,
            status: c.status,
            error: c.error,
          })),
        }
      : null,
    theaters,
    totals: {
      theaters: theaters.length,
      shows: Object.values(byLevel).reduce((a, b) => a + b, 0),
      byLevel,
    },
    isLive: isBookMyShowLive(),
  };
}

/** Show-level detail with full snapshot history, for the drill-down view. */
export async function getTheaterShows(campaignId: string, theaterId: string) {
  const screenings = await prisma.screening.findMany({
    where: { campaignId, theaterId },
    include: { snapshots: { orderBy: { capturedAt: "asc" } }, theater: true },
    orderBy: { showDateTime: "asc" },
  });

  return screenings.map((s) => ({
    id: s.id,
    bmsSessionId: s.bmsSessionId,
    showDateTime: s.showDateTime,
    showDate: s.showDate,
    language: s.language,
    format: s.format,
    priceBands: s.priceBands,
    disappearedAt: s.disappearedAt,
    lastSeenAt: s.lastSeenAt,
    theaterName: s.theater.name,
    cityName: s.theater.cityName,
    history: s.snapshots.map((snap) => ({
      capturedAt: snap.capturedAt,
      availStatus: snap.availStatus,
      demandLevel: snap.demandLevel as DemandLevel,
      confidence: snap.confidence,
      sourceLabel: snap.sourceLabel,
      styleId: snap.styleId,
    })),
  }));
}

/**
 * Raise alerts for theaters that came out of a scan in the "push here" band.
 *
 * Uses the existing NotifierProvider seam, so this is console-only (a dry run) until
 * DATA_MODE_NOTIFIER flips to "live" — no new notification machinery.
 *
 * Deduped per (campaign, theater, scan-interval window) via the existing Alert table:
 * a campaign scanned every 90 minutes would otherwise email the same "Palakkad is quiet"
 * line 16 times a day, which trains the recipient to ignore it. Alert delivery failures
 * are caught and logged rather than thrown — a mail outage must not fail a scan whose data
 * landed correctly.
 */
export async function raiseCampaignAlerts(
  campaignId: string,
  opts: { now?: Date } = {},
): Promise<{ raised: number; suppressed: number }> {
  const now = opts.now ?? new Date();
  const detail = await getTheaterCampaignDetail(campaignId, { now });
  if (!detail) return { raised: 0, suppressed: 0 };

  const targets = detail.theaters.filter((t) => t.priority.band === "high");
  if (targets.length === 0) return { raised: 0, suppressed: 0 };

  const windowStart = new Date(now.getTime() - detail.campaign.scanIntervalMinutes * 60_000);
  const notifier = getNotifierProvider();
  const channel = getNotifierChannel();

  let raised = 0;
  let suppressed = 0;

  for (const theater of targets) {
    const type = `bms_demand:${campaignId}:${theater.theaterId}`;
    const recent = await prisma.alert.findFirst({
      where: { type, createdAt: { gte: windowStart } },
      select: { id: true },
    });
    if (recent) {
      suppressed++;
      continue;
    }

    const message = [
      `${detail.campaign.movieName} — ${theater.name}, ${theater.cityName}`,
      `${theater.priority.wideOpenShows} of ${theater.priority.eligibleShows} shows still wide open.`,
      `Confidence: ${theater.priority.confidence}.`,
      `Reasons: ${theater.priority.reasons.join(" ")}`,
      // Never omitted. The recipient is being asked to spend money on the strength of an
      // availability label, and must not read it as a sales figure.
      `Based on BookMyShow availability labels, not ticket sales. BookMyShow publishes no seat counts.`,
    ].join("\n");

    const alert = await prisma.alert.create({
      data: { type, message, channel, campaignId: null },
    });

    try {
      await notifier.send({
        id: alert.id,
        type,
        message,
        createdAt: alert.createdAt.toISOString(),
      });
      await prisma.alert.update({ where: { id: alert.id }, data: { deliveredAt: new Date() } });
    } catch (err) {
      console.error(`${SCAN_LOG} alert delivery failed campaign=${campaignId} theater=${theater.theaterId}:`, err);
    }
    raised++;
  }

  console.log(`${SCAN_LOG} alerts campaign=${campaignId} raised=${raised} suppressed=${suppressed} channel=${channel}`);
  return { raised, suppressed };
}

export async function getScanRun(scanRunId: string) {
  return prisma.bmsScanRun.findUnique({
    where: { id: scanRunId },
    include: { cityResults: true },
  });
}

import "server-only";

import { prisma } from "@/lib/prisma";
import { readDemand, type DemandLevel } from "@/lib/bookmyshow/demand";
import { istDateOnly, normalizeCityPage } from "@/lib/bookmyshow/normalize";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";
import { getBookMyShowProvider, isBookMyShowLive } from "@/lib/bookmyshow/providers";
import { scoreTheater, type ShowSignal, type TheaterPriority } from "@/lib/bookmyshow/scoring";
import { resolveRegions } from "@/lib/bookmyshow/urls";
import type { BmsScrapeItem, NormalizedCityResult } from "@/lib/bookmyshow/types";
import {
  BMS_BASIS_NOTE,
  digestSubject,
  formatCampaignAlertDigest,
  formatCampaignAlertDigestHtml,
  type TheaterAlertSummary,
} from "./theaterAlertDigest";

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

    // A write failure has to fail THIS city, the same way an unusable date or a region
    // mismatch does. Letting it throw out of the loop is what wedged the 2026-08-20 scan:
    // the first city's transaction blew its time limit, the throw escaped, and a 30-city
    // run ended with zero rows and a run row stuck in `running` with no error on it.
    let stored;
    try {
      stored = await ingestCityResult(campaignId, scanRunId, normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${SCAN_LOG} city ingest failed campaign=${campaignId} city=${normalized.cityCode}: ${message}`,
      );
      await prisma.bmsScanCityResult.update({
        where: {
          scanRunId_cityCode_showDate: { scanRunId, cityCode: normalized.cityCode, showDate },
        },
        // Overwrites the "ok" recorded a moment ago: the page was readable, but nothing
        // from it was stored, so counting it as succeeded would claim coverage we lack.
        data: { status: "error", error: `Could not store this city: ${message}` },
      });
      continue;
    }

    citiesSucceeded++;
    succeededCityCodes.add(normalized.cityCode);
    succeededDates.add(normalized.showDateCode);

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

// A single Kerala city page carries ~30 venues and ~180 shows. Written one row at a time
// that is ~390 sequential round trips to a pooled Supabase connection, which took the FIRST
// city past Prisma's 5s interactive-transaction limit — the transaction rolled back, the
// throw escaped the scan loop, and a Kerala-wide scan wrote exactly nothing while its run
// row sat in `running` forever. See the run recorded at 2026-08-20T08:46Z.
//
// So ingest is bulk: a fixed handful of statements per city no matter how many shows it
// carries. The timeout below is a backstop for a pathological page, not the fix — if a city
// ever needs more than this, the shape of the writes is wrong again.
const CITY_TX_TIMEOUT_MS = 20_000;
const CITY_TX_MAX_WAIT_MS = 10_000;

/** Element-wise, because comparing two arrays with !== is always true and would restore the N+1. */
function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** Last write wins within a page: BookMyShow can list the same venue or session twice. */
function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return [...byKey.values()];
}

/**
 * Collapse per-row updates into one updateMany per distinct payload.
 *
 * On a steady-state scan nothing has drifted and this issues zero statements. When a venue
 * really is renamed it is one or two rows, not the whole page, so the statement count stays
 * bounded either way.
 */
async function updateInGroups<T>(
  rows: { id: string; data: T }[],
  run: (ids: string[], data: T) => Promise<unknown>,
): Promise<void> {
  const groups = new Map<string, { ids: string[]; data: T }>();
  for (const row of rows) {
    const key = JSON.stringify(row.data);
    const existing = groups.get(key);
    if (existing) existing.ids.push(row.id);
    else groups.set(key, { ids: [row.id], data: row.data });
  }
  for (const group of groups.values()) await run(group.ids, group.data);
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
  const theaters = dedupeBy(normalized.theaters, (t) => t.venueCode);
  const screenings = dedupeBy(normalized.screenings, (s) => `${s.bmsSessionId}|${s.showDate.toISOString()}`);
  if (theaters.length === 0 && screenings.length === 0) {
    return { theaters: 0, screenings: 0, snapshots: 0, unmapped: 0 };
  }

  return prisma.$transaction(
    async (tx) => {
      const seenAt = new Date();

      await tx.theater.createMany({
        data: theaters.map((t) => ({
          source: "bookmyshow",
          venueCode: t.venueCode,
          name: t.name,
          cityCode: t.cityCode,
          cityName: t.cityName,
          chainCode: t.chainCode,
        })),
        skipDuplicates: true,
      });

      const storedTheaters = await tx.theater.findMany({
        where: { source: "bookmyshow", venueCode: { in: theaters.map((t) => t.venueCode) } },
        select: { id: true, venueCode: true, name: true, chainCode: true },
      });
      const theaterIdByVenue = new Map(storedTheaters.map((t) => [t.venueCode, t.id]));

      await tx.theater.updateMany({
        where: { id: { in: storedTheaters.map((t) => t.id) } },
        data: { lastSeenAt: seenAt },
      });

      // cityCode/cityName are deliberately absent here: they record where the venue was
      // FIRST seen, and BookMyShow lists the same venue under several adjacent regions.
      // Rewriting them each scan would make a theater appear to move between districts.
      const incomingTheater = new Map(theaters.map((t) => [t.venueCode, t]));
      await updateInGroups(
        storedTheaters
          .filter((stored) => {
            const t = incomingTheater.get(stored.venueCode);
            return t !== undefined && (t.name !== stored.name || t.chainCode !== stored.chainCode);
          })
          .map((stored) => {
            const t = incomingTheater.get(stored.venueCode)!;
            return { id: stored.id, data: { name: t.name, chainCode: t.chainCode } };
          }),
        (ids, data) => tx.theater.updateMany({ where: { id: { in: ids } }, data }),
      );

      const placeable = screenings.filter((s) => theaterIdByVenue.has(s.venueCode));
      if (placeable.length === 0) {
        return { theaters: theaters.length, screenings: screenings.length, snapshots: 0, unmapped: 0 };
      }

      await tx.screening.createMany({
        data: placeable.map((s) => ({
          campaignId,
          theaterId: theaterIdByVenue.get(s.venueCode)!,
          bmsSessionId: s.bmsSessionId,
          showDate: s.showDate,
          showDateTime: s.showDateTime,
          cutOffAt: s.cutOffAt,
          language: s.language,
          format: s.format,
          priceBands: s.priceBands,
        })),
        skipDuplicates: true,
      });

      // Keyed on the full unique tuple, not on bmsSessionId alone — a session id repeats
      // across dates and matching on it alone would attach today's reading to yesterday's
      // show. The `in` filters are a superset; the map lookup is what is exact.
      const storedScreenings = await tx.screening.findMany({
        where: {
          campaignId,
          bmsSessionId: { in: placeable.map((s) => s.bmsSessionId) },
          showDate: { in: [...new Set(placeable.map((s) => s.showDate.getTime()))].map((t) => new Date(t)) },
        },
        select: {
          id: true,
          bmsSessionId: true,
          showDate: true,
          showDateTime: true,
          cutOffAt: true,
          language: true,
          format: true,
          priceBands: true,
        },
      });
      const screeningKey = (sessionId: string, showDate: Date) => `${sessionId}|${showDate.toISOString()}`;
      const screeningIdByKey = new Map(
        storedScreenings.map((s) => [screeningKey(s.bmsSessionId, s.showDate), s.id]),
      );

      const touchedIds = placeable
        .map((s) => screeningIdByKey.get(screeningKey(s.bmsSessionId, s.showDate)))
        .filter((id): id is string => id !== undefined);

      await tx.screening.updateMany({
        where: { id: { in: touchedIds } },
        // A show that reappears after vanishing is no longer gone. Without clearing
        // disappearedAt a temporary blip would leave it permanently marked as disappeared.
        // lastSeenAt matters just as much: markDisappeared reads it, so a scan that failed
        // to refresh it would mark the entire slate as pulled on the NEXT run.
        data: { lastSeenAt: seenAt, disappearedAt: null },
      });

      const incomingScreening = new Map(
        placeable.map((s) => [screeningKey(s.bmsSessionId, s.showDate), s]),
      );
      await updateInGroups(
        storedScreenings
          .filter((stored) => {
            const s = incomingScreening.get(screeningKey(stored.bmsSessionId, stored.showDate));
            return (
              s !== undefined &&
              (!sameInstant(s.showDateTime, stored.showDateTime) ||
                !sameInstant(s.cutOffAt, stored.cutOffAt) ||
                s.language !== stored.language ||
                s.format !== stored.format ||
                !sameStrings(s.priceBands, stored.priceBands))
            );
          })
          .map((stored) => {
            const s = incomingScreening.get(screeningKey(stored.bmsSessionId, stored.showDate))!;
            return {
              id: stored.id,
              data: {
                showDateTime: s.showDateTime,
                cutOffAt: s.cutOffAt,
                language: s.language,
                format: s.format,
                priceBands: s.priceBands,
              },
            };
          }),
        (ids, data) => tx.screening.updateMany({ where: { id: { in: ids } }, data }),
      );

      let unmapped = 0;
      const snapshotRows = [];
      for (const s of placeable) {
        const screeningId = screeningIdByKey.get(screeningKey(s.bmsSessionId, s.showDate));
        if (!screeningId) continue;
        // The pill is passed as a fallback because live BookMyShow no longer sends
        // availStatus — see readPill in demand.ts. Both channels are stored on the
        // snapshot regardless, so a reading can always be re-derived from its raw source.
        const reading = readDemand(s.availStatus, { styleId: s.styleId, sourceLabel: s.sourceLabel });
        if (reading.unmapped) unmapped++;
        snapshotRows.push({
          screeningId,
          scanRunId,
          availStatus: s.availStatus,
          demandLevel: reading.level,
          styleId: s.styleId,
          sourceLabel: s.sourceLabel,
          confidence: reading.confidence,
        });
      }

      // The idempotency guarantee — one observation per show per scan run — is still the
      // database's, via the (screeningId, scanRunId) unique constraint. skipDuplicates
      // rather than upsert means first-reading-wins where the previous code was
      // last-reading-wins. That only bites when one run reads the same session on two city
      // pages, and both readings are equally true observations of that run.
      const created = await tx.availabilitySnapshot.createMany({
        data: snapshotRows,
        skipDuplicates: true,
      });

      return {
        theaters: theaters.length,
        screenings: screenings.length,
        snapshots: created.count,
        unmapped,
      };
    },
    { timeout: CITY_TX_TIMEOUT_MS, maxWait: CITY_TX_MAX_WAIT_MS },
  );
}

/**
 * Close out a run that died on an unexpected throw.
 *
 * runCampaignScan records its own known failures, but anything it does not anticipate
 * escapes with the run row still saying `running`. The scan status panel is the only place
 * a user is told what went wrong, so a run that cannot say it failed is a silent failure.
 *
 * Best-effort and swallowing by design: this is called from a catch block, and if the
 * database is what broke then this write breaks too. Masking the original error with a
 * second one would lose the only useful diagnostic.
 */
/**
 * Why a mock-provider scan must not run against this campaign, or null if it may.
 *
 * "Run scan now" uses whatever `DATA_MODE_BOOKMYSHOW` selects, and that is `mock` in every
 * deployment today because server-side collection is blocked (see BOOKMYSHOW-FEASIBILITY.md
 * §6). On a campaign holding real captured data, clicking it would inject ~178 fabricated
 * theaters and thousands of invented readings straight into the table the user makes spend
 * decisions from.
 *
 * That is not a hypothetical. The opt-in database test drives this same code path, and twice
 * left 178 synthetic venues behind — codes like `KOCH01`, where a real BookMyShow venue is
 * `ZTKC`. Synthetic codes never merge with real ones, so they accumulate as permanent
 * phantoms, and the campaign detail page reads snapshots across ALL runs, so the ranking
 * would blend invented numbers with measured ones.
 *
 * Mock stays fully usable on a campaign that has no real data — that is what makes the
 * feature demoable without an Apify account. The rule is only that fixtures must never be
 * mixed into measurements.
 */
export async function mockScanBlockedReason(campaignId: string): Promise<string | null> {
  if (isBookMyShowLive()) return null;

  const realRun = await prisma.bmsScanRun.findFirst({
    where: { campaignId, provider: { not: "mock" }, status: { in: ["done", "partial"] } },
    select: { provider: true },
  });
  if (!realRun) return null;

  return (
    "This campaign holds real captured data, and a server-side scan can only produce mock " +
    "fixtures right now — BookMyShow blocks automated collection, so DATA_MODE_BOOKMYSHOW is " +
    "'mock'. Running it would mix invented theaters and readings into measured ones. Use the " +
    "local capture instead (scripts/bms-capture.mjs, or the desktop launcher)."
  );
}

export async function markLatestRunFailed(campaignId: string, message: string): Promise<void> {
  try {
    const running = await prisma.bmsScanRun.findFirst({
      where: { campaignId, status: { in: ["queued", "running"] } },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (!running) return;
    await prisma.bmsScanRun.update({
      where: { id: running.id },
      data: { status: "error", finishedAt: new Date(), error: message.slice(0, 500) },
    });
  } catch (err) {
    console.error(`${SCAN_LOG} could not record scan failure campaign=${campaignId}:`, err);
  }
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
  // Score is a SHARE, so it is size-blind: a theater with 3 of 3 shows wide open scores the
  // same as one with 25 of 25. They are not equally worth acting on — the second is the same
  // signal with eight times the evidence behind it. Ties therefore break on how many shows
  // back the reading up, and only then on name.
  theaters.sort(
    (a, b) =>
      b.priority.score - a.priority.score ||
      b.priority.eligibleShows - a.priority.eligibleShows ||
      a.name.localeCompare(b.name),
  );

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
 * a campaign scanned every 90 minutes would otherwise report the same "Palakkad is quiet"
 * line 16 times a day, which trains the recipient to ignore it. Alert delivery failures
 * are caught and logged rather than thrown — a mail outage must not fail a scan whose data
 * landed correctly.
 *
 * Two separate volume controls, because there were two separate ways to flood an inbox:
 *   - the dedup window above bounds how OFTEN one theater may be reported;
 *   - the digest bounds how MANY messages one scan produces. Sends are batched into a
 *     single summary email at the end (see theaterAlertDigest.ts) rather than one per
 *     theater, which is what turned a 32-theater scan into 32 emails.
 * Note this is one email per campaign per scan — the cron loops campaigns and calls this
 * once each, so a deployment with several active campaigns still gets one mail per
 * campaign.
 */
/**
 * How long the same theater stays quiet after alerting.
 *
 * Was just `scanIntervalMinutes`, which was correct while the only caller was the Vercel
 * cron: scans and alerts shared a cadence, so "once per scan interval" meant "once per
 * scan". The local capture path broke that assumption. Captures run three times a day, five
 * hours apart, and the campaign's interval is 90 minutes — so every run fell outside the
 * window and re-alerted every flagged theater.
 *
 * Measured on 2026-08-20: 32 flagged theaters × 3 runs a day is ~96 notifications daily,
 * and at full Kerala coverage (~178 theaters) it would be ~530. Precisely the outcome the
 * dedup was written to prevent — the doc comment even says "trains the recipient to ignore
 * it".
 *
 * So the interval becomes a FLOOR, not the whole rule: whichever is longer, the campaign's
 * own interval or this default. Twelve hours means a theater that is quiet all day is
 * mentioned at most twice, which is the point at which the message still carries weight.
 */
const ALERT_DEDUP_FLOOR_MINUTES = Number(process.env.BOOKMYSHOW_ALERT_DEDUP_MINUTES) || 720;

export function alertDedupMinutes(scanIntervalMinutes: number): number {
  return Math.max(scanIntervalMinutes, ALERT_DEDUP_FLOOR_MINUTES);
}

export async function raiseCampaignAlerts(
  campaignId: string,
  opts: { now?: Date } = {},
): Promise<{ raised: number; suppressed: number }> {
  const now = opts.now ?? new Date();
  const detail = await getTheaterCampaignDetail(campaignId, { now });
  if (!detail) return { raised: 0, suppressed: 0 };

  const targets = detail.theaters.filter((t) => t.priority.band === "high");
  if (targets.length === 0) return { raised: 0, suppressed: 0 };

  const windowStart = new Date(now.getTime() - alertDedupMinutes(detail.campaign.scanIntervalMinutes) * 60_000);
  const notifier = getNotifierProvider();
  const channel = getNotifierChannel();

  let suppressed = 0;
  // Rows first, one send at the end. The Alert row per theater is what dedup reads back
  // on the next scan, so it stays per-theater and is written inside the loop exactly as
  // before; only delivery is pulled out. Collapsing the rows too would silently widen
  // dedup to per-campaign — a theater going quiet at 14:00 would be suppressed because a
  // different theater alerted at 13:00.
  const pending: { alertId: string; summary: TheaterAlertSummary }[] = [];

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

    const summary: TheaterAlertSummary = {
      theaterId: theater.theaterId,
      name: theater.name,
      cityName: theater.cityName,
      wideOpenShows: theater.priority.wideOpenShows,
      eligibleShows: theater.priority.eligibleShows,
      confidence: theater.priority.confidence,
      reasons: theater.priority.reasons,
    };

    // The stored row keeps its own standalone text — it is the per-theater audit record
    // and is read on its own, out of the digest's context, so it still carries the basis
    // note. Only the email is a digest.
    const message = [
      `${detail.campaign.movieName} — ${theater.name}, ${theater.cityName}`,
      `${theater.priority.wideOpenShows} of ${theater.priority.eligibleShows} shows still wide open.`,
      `Confidence: ${theater.priority.confidence}.`,
      `Reasons: ${theater.priority.reasons.join(" ")}`,
      BMS_BASIS_NOTE,
    ].join("\n");

    const alert = await prisma.alert.create({
      data: { type, message, channel, campaignId: null },
    });
    pending.push({ alertId: alert.id, summary });
  }

  const raised = pending.length;

  if (raised > 0) {
    const digest = {
      movieName: detail.campaign.movieName,
      theaters: pending.map((p) => p.summary),
      generatedAt: now,
    };
    const ids = pending.map((p) => p.alertId);

    try {
      // One email for the whole scan. The Alert row this send is stamped against is the
      // first of the batch purely so the notifier has an id to carry; deliveredAt is then
      // stamped across every row the digest covered, since one delivery covers them all.
      await notifier.send({
        id: ids[0],
        type: `bms_demand_digest:${campaignId}`,
        subject: digestSubject(digest),
        message: formatCampaignAlertDigest(digest),
        createdAt: now.toISOString(),
        html: formatCampaignAlertDigestHtml(digest),
      });
      await prisma.alert.updateMany({ where: { id: { in: ids } }, data: { deliveredAt: new Date() } });
    } catch (err) {
      // A mail outage must not fail a scan whose data landed correctly — the rows are
      // already written, they just stay unstamped.
      console.error(`${SCAN_LOG} alert delivery failed campaign=${campaignId} theaters=${raised}:`, err);
    }
  }

  console.log(
    `${SCAN_LOG} alerts campaign=${campaignId} raised=${raised} suppressed=${suppressed} emails=${raised > 0 ? 1 : 0} channel=${channel}`,
  );
  return { raised, suppressed };
}

export async function getScanRun(scanRunId: string) {
  return prisma.bmsScanRun.findUnique({
    where: { id: scanRunId },
    include: { cityResults: true },
  });
}

// Fixture-backed BookMyShow provider.
//
// Exists so the whole feature — scan, ingest, scoring, every screen — is exercisable
// without an Apify account, a network call, or any traffic to BookMyShow. That is not
// only a dev convenience: at the time of writing it is unproven that an Apify cloud actor
// can load these pages at all (BOOKMYSHOW-FEASIBILITY.md §8), so this is the path that
// keeps the rest of the system reviewable regardless of how that question lands.
//
// The per-city profiles below are REAL MEASUREMENTS taken during the 2026-08-20 sweep of
// Bethlehem Kudumba Unit across all 30 Kerala regions. Using them rather than invented
// numbers means the mock UI shows the actual shape of the problem — Palakkad genuinely
// flat, Kochi genuinely the healthiest — so the ranking can be sanity-checked against
// reality before a single live scan runs.
//
// Every scan served from here is stamped provider="mock" on its BmsScanRun so a
// fixture-backed figure can never be mistaken for a live one in the UI.

import { KERALA_REGIONS, regionByCode } from "../urls";
import type { BmsRawShow, BmsRawVenue, BmsScrapeItem, BookMyShowProvider } from "../types";

interface CityProfile {
  venues: number;
  shows: number;
  /** availStatus -> count, as measured. */
  dist: Record<string, number>;
}

/** Measured 2026-08-20, show date 2026-08-21. See BOOKMYSHOW-FEASIBILITY.md §6. */
const MEASURED: Record<string, CityProfile> = {
  KOCH: { venues: 27, shows: 150, dist: { 1: 13, 2: 50, 3: 87 } },
  TRIV: { venues: 30, shows: 158, dist: { 1: 1, 2: 15, 3: 142 } },
  THSR: { venues: 22, shows: 113, dist: { 1: 1, 2: 6, 3: 106 } },
  KOLM: { venues: 12, shows: 54, dist: { 0: 5, 2: 8, 3: 41 } },
  ALPZ: { venues: 11, shows: 47, dist: { 0: 8, 3: 39 } },
  PLKK: { venues: 11, shows: 44, dist: { 3: 44 } },
  KOZH: { venues: 9, shows: 51, dist: { 2: 9, 3: 42 } },
  KTYM: { venues: 6, shows: 29, dist: { 2: 7, 3: 22 } },
  ANGA: { venues: 4, shows: 19, dist: { 2: 6, 3: 13 } },
  KARR: { venues: 4, shows: 19, dist: { 2: 3, 3: 16 } },
  VDKR: { venues: 4, shows: 17, dist: { 3: 17 } },
  PTNM: { venues: 3, shows: 14, dist: { 3: 14 } },
  MAJR: { venues: 3, shows: 14, dist: { 1: 1, 2: 1, 3: 12 } },
  IRNK: { venues: 3, shows: 15, dist: { 2: 2, 3: 13 } },
  CNSY: { venues: 3, shows: 13, dist: { 2: 1, 3: 12 } },
  KKNN: { venues: 3, shows: 12, dist: { 2: 1, 3: 11 } },
  PUNA: { venues: 3, shows: 12, dist: { 3: 12 } },
  KANN: { venues: 2, shows: 8, dist: { 2: 3, 3: 5 } },
  PNTM: { venues: 2, shows: 9, dist: { 3: 9 } },
  THOD: { venues: 2, shows: 10, dist: { 2: 2, 3: 8 } },
  MUVA: { venues: 2, shows: 9, dist: { 2: 1, 3: 8 } },
  KUNN: { venues: 2, shows: 8, dist: { 2: 1, 3: 7 } },
  KAYA: { venues: 2, shows: 9, dist: { 3: 9 } },
  KTMM: { venues: 2, shows: 9, dist: { 3: 9 } },
  THVL: { venues: 1, shows: 5, dist: { 2: 2, 3: 3 } },
  OTTP: { venues: 1, shows: 4, dist: { 3: 4 } },
  PALL: { venues: 1, shows: 4, dist: { 3: 4 } },
  THAY: { venues: 1, shows: 5, dist: { 1: 5 } },
  TALI: { venues: 1, shows: 5, dist: { 3: 5 } },
  GOOL: { venues: 1, shows: 4, dist: { 3: 4 } },
};

/** A handful of real venue names observed in the sweep, for recognisability. */
const REAL_VENUE_NAMES: Record<string, string[]> = {
  KOCH: [
    "PVR: Forum Mall, Kochi",
    "PVR: Lulu, Kochi",
    "Cinepolis: Centre Square, Kochi",
    "Shenoys: Kochi",
    "Padma Cinema: Kochi",
    "PVR: Oberon Mall, Kochi",
    "Sridar: Marine Drive, Kochi",
  ],
  KOZH: ["Miraj Cinemas: Blue Diamond Mall, Calicut"],
  THSR: ["Sreelakshmi Cinema Amballur 4K/2K Laser Projection"],
};

const SHOW_TIMES = [
  "09:00 AM", "10:30 AM", "11:45 AM", "01:10 PM", "02:30 PM",
  "03:55 PM", "06:15 PM", "07:30 PM", "09:45 PM", "10:50 PM",
];

/**
 * Deterministic-per-bucket PRNG.
 *
 * Seeded from city + date + a 30-minute wall-clock bucket, so a mock scan is stable if you
 * re-run it immediately but drifts over time. That drift is deliberate: without it every
 * snapshot would be identical, movement would always be zero, and the trend chart and the
 * "demand has not moved" scoring rule would be impossible to see working in dev.
 */
function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Expand a measured distribution into a flat, shuffled list of statuses. */
function statusPool(profile: CityProfile, rng: () => number): number[] {
  const pool: number[] = [];
  for (const [status, count] of Object.entries(profile.dist)) {
    for (let i = 0; i < count; i++) pool.push(Number(status));
  }
  while (pool.length < profile.shows) pool.push(3);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, profile.shows);
}

function venueName(cityCode: string, cityName: string, index: number): string {
  const real = REAL_VENUE_NAMES[cityCode];
  if (real && index < real.length) return real[index];
  return `${cityName} Cinema ${index + 1}`;
}

function buildShow(status: number, index: number, dateCode: string, venueCode: string): BmsRawShow {
  const time = SHOW_TIMES[index % SHOW_TIMES.length];
  const styleId = status === 3 ? "green-pill-with-border" : status === 0 ? "grey-pill" : "orange-pill-with-border";
  return {
    title: time,
    styleId,
    subtitleAcronym: index % 3 === 0 ? "MAL" : index % 3 === 1 ? "LUXE" : "Atmos",
    filters: status === 3 ? ["pf2", "pf3"] : ["pf3", "pf4"],
    additionalData: {
      // Stable across scans for the same venue/date/slot — this is what makes repeated
      // mock scans idempotent the same way real session ids do.
      sessionId: `${venueCode}-${dateCode}-${index}`,
      availStatus: status,
      showDateCode: dateCode,
      showTime: time,
    },
    cta: {
      analytics: {
        show_session_id: `${venueCode}-${dateCode}-${index}`,
        metadata: status === 2 ? '{"venue_info":["fast_filling"]}' : "{}",
      },
    },
  };
}

/** One city that fails every scan, so the partial-failure UI is reachable in dev. */
const ALWAYS_FAILS = "GOOL";

export class MockBookMyShowProvider implements BookMyShowProvider {
  readonly name = "mock" as const;

  constructor(private readonly seedOverride?: string) {}

  async fetchShowtimes(opts: {
    eventCode: string;
    movieSlug: string;
    regionCodes: string[];
    dates: Date[];
  }): Promise<BmsScrapeItem[]> {
    const bucket = this.seedOverride ?? String(Math.floor(Date.now() / (30 * 60 * 1000)));
    const items: BmsScrapeItem[] = [];

    const codes = opts.regionCodes.length > 0 ? opts.regionCodes : KERALA_REGIONS.map((r) => r.code);

    for (const code of codes) {
      for (const date of opts.dates) {
        const dateCode = toDateCode(date);

        if (code === ALWAYS_FAILS) {
          items.push({
            cityCode: code,
            showDateCode: dateCode,
            error: "Mock provider: simulated page load failure so partial-scan handling stays visible in dev",
          });
          continue;
        }

        const region = regionByCode(code);
        const profile = MEASURED[code] ?? { venues: 2, shows: 8, dist: { 3: 8 } };
        const rng = makeRng(`${code}|${dateCode}|${bucket}|${opts.eventCode}`);
        const pool = statusPool(profile, rng);

        const venues: BmsRawVenue[] = [];
        let cursor = 0;
        for (let v = 0; v < profile.venues; v++) {
          const remainingVenues = profile.venues - v;
          const remainingShows = profile.shows - cursor;
          const take = Math.max(1, Math.round(remainingShows / remainingVenues));
          const venueCode = `${code}${String(v + 1).padStart(2, "0")}`;
          const showtimes = pool
            .slice(cursor, cursor + take)
            .map((status, i) => buildShow(status, i, dateCode, venueCode));
          cursor += take;
          venues.push({
            id: venueCode,
            additionalData: { venueCode, venueName: venueName(code, region?.name ?? code, v) },
            analytics: { company_code: venueCode.startsWith("KOCH") ? "PVR" : venueCode },
            showtimesSections: [{ showtimes }],
          });
        }

        items.push({
          cityCode: code,
          showDateCode: dateCode,
          // Must match what the region guard expects, or the mock would fail its own check.
          queryKey: `fetchPrimaryDynamic-${opts.eventCode.toUpperCase()}---${dateCode}-${code}`,
          url: `mock://bookmyshow/${code}/${dateCode}`,
          venues,
        });
      }
    }

    return items;
  }
}

function toDateCode(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

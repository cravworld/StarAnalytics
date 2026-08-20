// Raw BookMyShow hydration payload -> normalized theaters and screenings.
//
// Every field read here is optional-chained and every failure is a SKIP WITH A REASON,
// never a throw. The payload is an undocumented internal shape that can change on any
// BookMyShow deploy; a normalizer that crashes takes the whole scan down, while one that
// skips loudly degrades to partial data plus a visible count of what it dropped. The
// counts are surfaced in the scan status UI so a schema change looks like "412 shows
// skipped: missing_session_id" rather than a mysteriously quiet campaign.

import { assertRegionMatch, regionByCode } from "./urls";
import type {
  BmsRawShow,
  BmsRawVenue,
  BmsScrapeItem,
  NormalizedCityResult,
  NormalizedScreening,
  NormalizedTheater,
  SkipReason,
} from "./types";

/** India Standard Time, the only timezone BookMyShow show times are ever expressed in. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Parse a show's start instant.
 *
 * `additionalData.showDateTime` was observed as a KEY during the spike but its exact
 * string format was never captured, so this deliberately does not depend on it: it tries
 * the field, and falls back to composing the requested date code with `showTime`. The
 * fallback is the reliable path, not an edge case — treat the ISO branch as opportunistic.
 *
 * Returns null rather than an approximate date. A wrong show time silently shifts
 * "hours until screening", which drives the priority score, so a bad parse must drop the
 * row instead of guessing.
 */
export function parseShowInstant(
  raw: BmsRawShow,
  fallbackDateCode: string,
): { showDateTime: Date; showDate: Date } | null {
  const add = raw.additionalData ?? {};

  const iso = typeof add.showDateTime === "string" ? add.showDateTime.trim() : "";
  if (iso) {
    // Only trust it when it carries an explicit offset or Z. A bare "2026-08-21 19:30"
    // would be parsed as UTC by Date and land 5.5 hours off.
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return { showDateTime: d, showDate: istDateOnly(d) };
    }
  }

  const dateCode = (add.showDateCode || fallbackDateCode || "").trim();
  const time = (add.showTime || raw.title || "").trim();
  const composed = composeIst(dateCode, time);
  if (composed) return { showDateTime: composed, showDate: istDateOnly(composed) };

  return null;
}

/** "20260821" + "07:30 PM" | "19:30" -> UTC Date. */
function composeIst(dateCode: string, time: string): Date | null {
  const dm = dateCode.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!dm) return null;
  const [, y, mo, d] = dm;

  let hh: number | null = null;
  let mm = 0;
  const twelve = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const twentyFour = time.match(/^(\d{1,2}):(\d{2})$/);
  if (twelve) {
    hh = Number(twelve[1]) % 12;
    mm = Number(twelve[2]);
    if (/PM/i.test(twelve[3])) hh += 12;
  } else if (twentyFour) {
    hh = Number(twentyFour[1]);
    mm = Number(twentyFour[2]);
  }
  if (hh === null || hh > 23 || mm > 59) return null;

  // Build the IST wall-clock instant, then shift to UTC.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, mm) - IST_OFFSET_MINUTES * 60_000;
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * The IST calendar date a show belongs to, as midnight UTC (matching the @db.Date column).
 *
 * Load-bearing for late-night shows: a 00:30 IST show on the 22nd is 19:00 UTC on the
 * 21st, and grouping it under the 21st would put it in the wrong day's report.
 */
export function istDateOnly(instant: Date): Date {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** Pull the plain-text status label out of the analytics blob, if present. */
export function readSourceLabel(raw: BmsRawShow): string | null {
  const meta = raw.cta?.analytics?.metadata;
  if (typeof meta !== "string") return null;
  try {
    const parsed = JSON.parse(meta) as { venue_info?: unknown };
    const info = parsed.venue_info;
    if (Array.isArray(info) && info.length > 0 && typeof info[0] === "string") return info[0];
  } catch {
    // Malformed analytics metadata is cosmetic — it corroborates availStatus, it is not
    // the signal itself. Never let it fail a row.
  }
  return null;
}

/** Price-band tags only (pf*). Time-band tags (tf*) are dropped — different axis. */
export function readPriceBands(raw: BmsRawShow): string[] {
  if (!Array.isArray(raw.filters)) return [];
  return raw.filters.filter((f) => typeof f === "string" && /^pf\d+$/i.test(f));
}

function readVenueCode(venue: BmsRawVenue): string | null {
  const code = venue.additionalData?.venueCode || venue.id;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function readSessionId(raw: BmsRawShow): string | null {
  const id = raw.additionalData?.sessionId ?? raw.cta?.analytics?.show_session_id;
  if (typeof id === "number") return String(id);
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Normalize one scraped page.
 *
 * The region assertion runs FIRST and short-circuits everything else. BookMyShow serves
 * whatever region its `rgn` cookie says regardless of the URL, so a mismatch means the
 * venues below belong to a different city — importing them would attribute one district's
 * demand to another. That is recorded as a failed city, not silently corrected.
 */
export function normalizeCityPage(item: BmsScrapeItem): NormalizedCityResult {
  const base = {
    cityCode: item.cityCode,
    showDateCode: item.showDateCode,
    theaters: [] as NormalizedTheater[],
    screenings: [] as NormalizedScreening[],
    skipped: [] as { reason: SkipReason; detail?: string }[],
  };

  if (item.error) {
    return { ...base, status: "error", returnedCityCode: null, error: item.error };
  }

  const { ok, returnedCode } = assertRegionMatch(item.cityCode, item.queryKey);
  if (!ok) {
    return {
      ...base,
      status: "region_mismatch",
      returnedCityCode: returnedCode,
      error: `Requested ${item.cityCode} but BookMyShow served ${returnedCode ?? "an unidentified region"}`,
      skipped: [{ reason: "region_mismatch", detail: returnedCode ?? undefined }],
    };
  }

  const region = regionByCode(item.cityCode);
  const cityName = region?.name ?? item.cityCode;
  const theaters = new Map<string, NormalizedTheater>();
  const screenings: NormalizedScreening[] = [];
  const skipped: { reason: SkipReason; detail?: string }[] = [];

  for (const venue of item.venues ?? []) {
    const venueCode = readVenueCode(venue);
    if (!venueCode) {
      skipped.push({ reason: "missing_venue_code" });
      continue;
    }

    if (!theaters.has(venueCode)) {
      theaters.set(venueCode, {
        venueCode,
        name: venue.additionalData?.venueName?.trim() || venueCode,
        chainCode: venue.analytics?.company_code?.trim() || null,
        cityCode: item.cityCode,
        cityName,
      });
    }

    for (const section of venue.showtimesSections ?? []) {
      for (const show of section.showtimes ?? []) {
        const sessionId = readSessionId(show);
        if (!sessionId) {
          skipped.push({ reason: "missing_session_id", detail: venueCode });
          continue;
        }
        const when = parseShowInstant(show, item.showDateCode);
        if (!when) {
          skipped.push({ reason: "unparseable_show_time", detail: `${venueCode}/${sessionId}` });
          continue;
        }

        const cutOffEpoch = show.additionalData?.cutOffDateTimeEpoch;
        screenings.push({
          venueCode,
          bmsSessionId: sessionId,
          showDateTime: when.showDateTime,
          showDate: when.showDate,
          cutOffAt:
            typeof cutOffEpoch === "number" && cutOffEpoch > 0
              ? new Date(cutOffEpoch < 1e12 ? cutOffEpoch * 1000 : cutOffEpoch)
              : null,
          // BookMyShow packs both language ("ENG") and format ("LUXE"/"Atmos") into one
          // acronym slot and never sends both. Treated as a format unless it looks like a
          // 3-letter language tag — imperfect, and deliberately kept as raw source text
          // rather than being coerced into an enum we do not control.
          language: isLanguageAcronym(show.subtitleAcronym) ? show.subtitleAcronym!.trim() : null,
          format: isLanguageAcronym(show.subtitleAcronym) ? null : show.subtitleAcronym?.trim() || null,
          priceBands: readPriceBands(show),
          availStatus:
            typeof show.additionalData?.availStatus === "number" ? show.additionalData.availStatus : null,
          styleId: show.styleId?.trim() || null,
          sourceLabel: readSourceLabel(show),
        });
      }
    }
  }

  return {
    ...base,
    status: "ok",
    returnedCityCode: returnedCode,
    error: null,
    theaters: [...theaters.values()],
    screenings,
    skipped,
  };
}

const LANGUAGE_ACRONYMS = new Set(["ENG", "MAL", "HIN", "TAM", "TEL", "KAN", "MAR", "BEN", "GUJ", "PUN"]);

function isLanguageAcronym(value: string | undefined): boolean {
  return typeof value === "string" && LANGUAGE_ACRONYMS.has(value.trim().toUpperCase());
}

// Provider seam types for BookMyShow demand scanning.
//
// Screens and the data layer depend on these, never on the raw BookMyShow payload shape —
// same discipline as src/lib/providers/types.ts. The raw shape is an undocumented internal
// hydration state that can change without notice; keeping it behind this boundary means a
// change breaks one normalizer with tests, not the whole feature.

/** What the page function extracts from one (region, date) page render. */
export interface BmsRawShow {
  title?: string;
  styleId?: string;
  subtitleAcronym?: string;
  additionalData?: {
    sessionId?: string | number;
    availStatus?: number;
    showDateTime?: string;
    showDateCode?: string;
    showTime?: string;
    showTimeCode?: string;
    cutOffDateTimeEpoch?: number;
  };
  filters?: string[];
  cta?: {
    analytics?: {
      company_code?: string;
      metadata?: string;
      show_session_id?: string;
    };
  };
}

export interface BmsRawVenue {
  id?: string;
  additionalData?: {
    venueCode?: string;
    venueName?: string;
  };
  analytics?: { company_code?: string };
  showtimesSections?: { showtimes?: BmsRawShow[] }[];
}

/**
 * One scraped page. `error` and `venues` are mutually exclusive in practice, but both are
 * optional so a partial result is representable — a city that failed still produces a row
 * so the scan can record "not scanned" rather than "no shows".
 */
export interface BmsScrapeItem {
  /** The region code we ASKED for. */
  cityCode: string;
  /** The show date we asked for, YYYYMMDD. */
  showDateCode: string;
  /** RTK query key from the payload — carries the region code the page actually served. */
  queryKey?: string | null;
  url?: string;
  error?: string;
  venues?: BmsRawVenue[];
}

export interface NormalizedTheater {
  venueCode: string;
  name: string;
  chainCode: string | null;
  cityCode: string;
  cityName: string;
}

export interface NormalizedScreening {
  venueCode: string;
  bmsSessionId: string;
  /** UTC instant of the show start. */
  showDateTime: Date;
  /** The show's own calendar date (IST), midnight UTC — matches the @db.Date column. */
  showDate: Date;
  cutOffAt: Date | null;
  language: string | null;
  format: string | null;
  priceBands: string[];
  availStatus: number | null;
  styleId: string | null;
  sourceLabel: string | null;
}

export type SkipReason =
  | "missing_venue_code"
  | "missing_session_id"
  | "unparseable_show_time"
  | "region_mismatch"
  | "page_error";

export interface NormalizedCityResult {
  cityCode: string;
  showDateCode: string;
  status: "ok" | "error" | "region_mismatch";
  returnedCityCode: string | null;
  error: string | null;
  theaters: NormalizedTheater[];
  screenings: NormalizedScreening[];
  skipped: { reason: SkipReason; detail?: string }[];
}

/** The seam every BookMyShow data source implements. */
export interface BookMyShowProvider {
  readonly name: "apify" | "mock";
  /**
   * Fetch one page per (region, date) pair. Implementations must return one item per
   * requested pair even when it failed, so the caller can tell "not scanned" from "empty".
   */
  fetchShowtimes(opts: {
    eventCode: string;
    movieSlug: string;
    regionCodes: string[];
    dates: Date[];
  }): Promise<BmsScrapeItem[]>;
}

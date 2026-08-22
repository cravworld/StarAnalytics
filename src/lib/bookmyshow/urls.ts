// URL construction, region handling, and the input allowlist for BookMyShow scans.
//
// Two jobs, both security-relevant:
//
// 1. This feature must never become a generic arbitrary-URL scraper. A user supplies a
//    BookMyShow event code (or a URL we parse one out of), and every URL the scanner
//    visits is BUILT here from that code plus a region from the registry below. A
//    user-supplied URL is never fetched verbatim.
//
// 2. BookMyShow resolves the display region from an `rgn` COOKIE, not from the city in
//    the URL path. During the 2026-08-20 spike, three different city URLs all returned
//    Kochi data and the URL silently rewrote itself. A scanner that trusts the path will
//    attribute one city's demand to another — see assertRegionMatch below.

/** The only host this feature will ever fetch. */
export const BMS_HOST = "in.bookmyshow.com";

export interface BmsRegion {
  /** BookMyShow region code, uppercase — e.g. "KOCH". This is what the payload echoes back. */
  code: string;
  /** URL slug half of the "code:slug" path segment — e.g. "kochi". */
  slug: string;
  /** Display name. */
  name: string;
  lat: string;
  long: string;
}

/**
 * Kerala regions as enumerated during the 2026-08-20 sweep.
 *
 * NOTE THE PROVENANCE. This list came from `sitemap/movie-shows.xml`, which is an SEO
 * artifact with no completeness guarantee — it is the set of Kerala regions that happened
 * to be listed for one film on one day, not BookMyShow's authoritative region list. It is
 * a starting point, not the source of truth: `discoverRegionsForEvent` should replace it
 * once we can enumerate regions from BookMyShow directly. Under-enumerating here silently
 * drops theaters that ARE on BookMyShow, which is exactly the failure the campaign owner
 * cares about.
 */
export const KERALA_REGIONS: BmsRegion[] = [
  { code: "KOCH", slug: "kochi", name: "Kochi", lat: "9.9312328", long: "76.2673041" },
  { code: "TRIV", slug: "thiruvananthapuram-trivandrum", name: "Thiruvananthapuram", lat: "8.5241", long: "76.9366" },
  { code: "THSR", slug: "thrissur", name: "Thrissur", lat: "10.5276", long: "76.2144" },
  { code: "KOZH", slug: "kozhikode", name: "Kozhikode", lat: "11.2588", long: "75.7804" },
  { code: "KOLM", slug: "kollam", name: "Kollam", lat: "8.8932", long: "76.6141" },
  { code: "ALPZ", slug: "alappuzha", name: "Alappuzha", lat: "9.4981", long: "76.3388" },
  { code: "KTYM", slug: "kottayam", name: "Kottayam", lat: "9.5916", long: "76.5222" },
  { code: "KANN", slug: "kannur", name: "Kannur", lat: "11.8745", long: "75.3704" },
  { code: "PLKK", slug: "palakkad", name: "Palakkad", lat: "10.7867", long: "76.6548" },
  { code: "PNTM", slug: "perinthalmanna", name: "Perinthalmanna", lat: "10.9757", long: "76.2265" },
  { code: "THOD", slug: "thodupuzha", name: "Thodupuzha", lat: "9.8956", long: "76.7183" },
  { code: "MUVA", slug: "muvattupuzha", name: "Muvattupuzha", lat: "9.9894", long: "76.5790" },
  { code: "PTNM", slug: "pathanamthitta", name: "Pathanamthitta", lat: "9.2648", long: "76.7870" },
  { code: "THVL", slug: "thiruvalla", name: "Thiruvalla", lat: "9.3833", long: "76.5741" },
  { code: "MAJR", slug: "manjeri", name: "Manjeri", lat: "11.1200", long: "76.1200" },
  { code: "ANGA", slug: "angamaly", name: "Angamaly", lat: "10.1960", long: "76.3860" },
  { code: "IRNK", slug: "irinjalakuda", name: "Irinjalakuda", lat: "10.3417", long: "76.2114" },
  { code: "KUNN", slug: "kunnamkulam", name: "Kunnamkulam", lat: "10.6500", long: "76.0700" },
  { code: "OTTP", slug: "ottapalam", name: "Ottapalam", lat: "10.7700", long: "76.3770" },
  { code: "PALL", slug: "pala", name: "Pala", lat: "9.7140", long: "76.6860" },
  { code: "CNSY", slug: "changanassery", name: "Changanassery", lat: "9.4450", long: "76.5400" },
  { code: "KAYA", slug: "kayamkulam", name: "Kayamkulam", lat: "9.1800", long: "76.5000" },
  { code: "KTMM", slug: "kothamangalam", name: "Kothamangalam", lat: "10.0600", long: "76.6300" },
  { code: "VDKR", slug: "vadakara", name: "Vadakara", lat: "11.6000", long: "75.5900" },
  { code: "THAY", slug: "thalassery", name: "Thalassery", lat: "11.7500", long: "75.4900" },
  { code: "TALI", slug: "taliparamba", name: "Taliparamba", lat: "12.0400", long: "75.3600" },
  { code: "KKNN", slug: "kanhangad", name: "Kanhangad", lat: "12.3100", long: "75.0900" },
  { code: "PUNA", slug: "punalur", name: "Punalur", lat: "9.0100", long: "76.9300" },
  { code: "KARR", slug: "kallara", name: "Kallara", lat: "8.7000", long: "76.9000" },
  { code: "GOOL", slug: "goolikkadavu", name: "Goolikkadavu", lat: "9.1000", long: "76.6000" },

  // Added 2026-08-22, after a full pass proved these areas were unreachable rather than
  // absent: every one of the 30 regions above was read successfully, and the campaign's own
  // theatre list still had whole towns with no venue found. Their regions were simply never
  // requested.
  //
  // The slugs came from the campaign owner using BookMyShow's city picker. The CODES were
  // then read from each region's own landing page, which reports its own regionCode the way
  // /explore/home/kochi reports KOCH — not guessed, because a wrong code silently returns a
  // neighbouring region's showtimes rather than failing, and the region assertion in
  // normalizeCityPage would then discard the page as a mismatch.
  { code: "KASA", slug: "kasaragod", name: "Kasaragod", lat: "12.5102", long: "74.9852" },
];

const REGIONS_BY_CODE = new Map(KERALA_REGIONS.map((r) => [r.code, r]));

export function regionByCode(code: string): BmsRegion | undefined {
  return REGIONS_BY_CODE.get(code.trim().toUpperCase());
}

/**
 * Resolve a campaign's configured cities to real regions.
 *
 * An EMPTY list means "every known Kerala region", which is this campaign's configured
 * default — never "no cities". Getting that backwards would turn a Kerala-wide campaign
 * into a silent no-op, so it is spelled out here rather than left to each caller.
 */
export function resolveRegions(cityCodes: readonly string[]): BmsRegion[] {
  if (cityCodes.length === 0) return [...KERALA_REGIONS];
  return cityCodes.map((c) => regionByCode(c)).filter((r): r is BmsRegion => Boolean(r));
}

const EVENT_CODE_RE = /^et\d{6,12}$/i;

export function isValidEventCode(code: string): boolean {
  return EVENT_CODE_RE.test(code.trim());
}

/**
 * Pull an event code out of whatever the user pasted.
 *
 * Accepts a bare code or a BookMyShow URL. Rejects anything on another host — this is the
 * allowlist that stops a campaign form being used to point our scraper at an arbitrary
 * site. Returns null rather than throwing so the caller can produce a field-level
 * validation message.
 */
export function parseEventCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (isValidEventCode(raw)) return raw.toLowerCase();

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  // Exact host match, not endsWith: "in.bookmyshow.com.evil.test" must not pass.
  if (url.hostname.toLowerCase() !== BMS_HOST) return null;

  const match = url.pathname.match(/\/(et\d{6,12})(?:\/|$)/i);
  return match ? match[1].toLowerCase() : null;
}

/** YYYYMMDD in the show's own local (IST) calendar terms. */
export function formatShowDateCode(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Build a showtime page URL.
 *
 * The movie-slug segment is cosmetic for routing purposes (BookMyShow resolves the film
 * from the event code), but it is included because the canonical sitemap form carries it
 * and a URL that matches the published shape is less likely to be treated as anomalous.
 */
export function buildShowtimeUrl(opts: {
  region: BmsRegion;
  movieSlug: string;
  eventCode: string;
  date?: Date;
}): string {
  const { region, movieSlug, eventCode, date } = opts;
  if (!isValidEventCode(eventCode)) {
    throw new Error(`Refusing to build a BookMyShow URL from an invalid event code: ${eventCode}`);
  }
  const city = `${region.code.toLowerCase()}:${region.slug}`;
  const base = `https://${BMS_HOST}/movies/${city}/${movieSlug}-${city}/buytickets/${eventCode.toLowerCase()}`;
  return date ? `${base}/${formatShowDateCode(date)}` : base;
}

/**
 * The `rgn` cookie value BookMyShow itself sets when a user picks a city.
 *
 * Setting this is equivalent to choosing a city in the UI — it is a first-party region
 * preference, not a session token, credential, or anything belonging to another user.
 */
export function buildRegionCookieValue(region: BmsRegion): string {
  return encodeURIComponent(
    JSON.stringify({
      regionNameSlug: region.slug,
      regionCodeSlug: region.code.toLowerCase(),
      regionName: region.name,
      regionCode: region.code,
      subName: "",
      subCode: "",
      Lat: region.lat,
      Long: region.long,
      countryCode: "IN",
      GeoHash: "t9y",
    }),
  );
}

/**
 * BookMyShow's hydrated payload keys its live query as
 * `fetchPrimaryDynamic-ET00502829---20260820-KOCH`. That trailing region code is the only
 * trustworthy statement of which city the data actually describes.
 */
export function extractReturnedRegionCode(queryKey: string | null | undefined): string | null {
  if (!queryKey) return null;
  const m = queryKey.match(/-([A-Z]{3,6})$/);
  return m ? m[1] : null;
}

/**
 * The region guard.
 *
 * Returns true only when the payload demonstrably describes the region we asked for. A
 * missing or mismatched code is treated as a failure, never as a pass: silently accepting
 * Kochi's data as Palakkad's would put campaign money in the wrong district, which is a
 * worse outcome than a scan that reports it could not read Palakkad.
 */
export function assertRegionMatch(
  requestedCode: string,
  queryKey: string | null | undefined,
): { ok: boolean; returnedCode: string | null } {
  const returnedCode = extractReturnedRegionCode(queryKey);
  return { ok: returnedCode === requestedCode.toUpperCase(), returnedCode };
}

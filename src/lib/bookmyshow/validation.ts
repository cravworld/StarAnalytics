// Campaign input validation.
//
// Kept as a pure module (no Prisma, no session) so it is unit-testable and so the same
// rules run for a Server Action and a route handler without being written twice. Server
// Actions are POST-reachable independently of the UI that renders them, so this is a real
// trust boundary, not form politeness — see node_modules/next/dist/docs/01-app/02-guides/
// server-actions.md, "Security".

import { KERALA_REGIONS, parseEventCode, regionByCode } from "./urls";

/**
 * Intervals a campaign may be scanned at.
 *
 * An allowlist rather than a numeric range, and the floor is deliberate: this scans a
 * third party's site, and a Kerala-wide pass is ~90 page loads. Letting someone type 1
 * would turn the feature into something indistinguishable from abuse.
 */
export const ALLOWED_SCAN_INTERVALS = [30, 60, 90, 120, 180, 360, 720, 1440] as const;

export interface CampaignFormInput {
  name?: unknown;
  movieName?: unknown;
  bmsUrlOrCode?: unknown;
  targetCityCodes?: unknown;
  screeningStartDate?: unknown;
  screeningEndDate?: unknown;
  scanIntervalMinutes?: unknown;
  wideOpenAlertPct?: unknown;
  minShowsForAlert?: unknown;
}

export interface ValidatedCampaign {
  name: string;
  movieName: string;
  bmsEventCode: string;
  bmsSourceUrl: string | null;
  targetCityCodes: string[];
  screeningStartDate: Date | null;
  screeningEndDate: Date | null;
  scanIntervalMinutes: number;
  wideOpenAlertPct: number;
  minShowsForAlert: number;
}

export type ValidationResult =
  | { ok: true; value: ValidatedCampaign }
  | { ok: false; errors: Record<string, string> };

export function validateCampaignInput(input: CampaignFormInput): ValidationResult {
  const errors: Record<string, string> = {};

  const name = str(input.name);
  if (!name) errors.name = "Give the campaign a name.";
  else if (name.length > 120) errors.name = "Keep the name under 120 characters.";

  const movieName = str(input.movieName);
  if (!movieName) errors.movieName = "Enter the movie name as it should appear.";
  else if (movieName.length > 200) errors.movieName = "Keep the movie name under 200 characters.";

  // The allowlist. Anything that is not a BookMyShow event code or an in.bookmyshow.com
  // URL is rejected here, which is what stops this form being used to point the scanner
  // at an arbitrary site.
  const rawSource = str(input.bmsUrlOrCode);
  const bmsEventCode = rawSource ? parseEventCode(rawSource) : null;
  if (!rawSource) {
    errors.bmsUrlOrCode = "Enter the BookMyShow movie URL or its event code (e.g. et00502829).";
  } else if (!bmsEventCode) {
    errors.bmsUrlOrCode =
      "That is not a BookMyShow movie link. Paste an in.bookmyshow.com URL or an event code like et00502829.";
  }

  const cityCodes = Array.isArray(input.targetCityCodes)
    ? input.targetCityCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
    : [];
  const unknownCities = cityCodes.filter((c) => !regionByCode(c));
  if (unknownCities.length > 0) {
    errors.targetCityCodes = `Unknown BookMyShow region${unknownCities.length === 1 ? "" : "s"}: ${unknownCities.join(", ")}.`;
  }

  const screeningStartDate = optionalDate(input.screeningStartDate);
  const screeningEndDate = optionalDate(input.screeningEndDate);
  if (screeningStartDate === "invalid") errors.screeningStartDate = "That is not a valid date.";
  if (screeningEndDate === "invalid") errors.screeningEndDate = "That is not a valid date.";
  if (
    screeningStartDate instanceof Date &&
    screeningEndDate instanceof Date &&
    screeningEndDate < screeningStartDate
  ) {
    errors.screeningEndDate = "The end date cannot be before the start date.";
  }

  const scanIntervalMinutes = num(input.scanIntervalMinutes, 90);
  if (!ALLOWED_SCAN_INTERVALS.includes(scanIntervalMinutes as (typeof ALLOWED_SCAN_INTERVALS)[number])) {
    errors.scanIntervalMinutes = `Choose one of: ${ALLOWED_SCAN_INTERVALS.join(", ")} minutes.`;
  }

  const wideOpenAlertPct = num(input.wideOpenAlertPct, 80);
  if (!Number.isInteger(wideOpenAlertPct) || wideOpenAlertPct < 1 || wideOpenAlertPct > 100) {
    errors.wideOpenAlertPct = "Enter a whole percentage between 1 and 100.";
  }

  const minShowsForAlert = num(input.minShowsForAlert, 3);
  if (!Number.isInteger(minShowsForAlert) || minShowsForAlert < 1 || minShowsForAlert > 50) {
    errors.minShowsForAlert = "Enter a whole number of shows between 1 and 50.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name: name!,
      movieName: movieName!,
      bmsEventCode: bmsEventCode!,
      // Only stored when the user actually pasted a URL, and only after it passed the
      // host check above — never arbitrary text.
      bmsSourceUrl: rawSource && rawSource.startsWith("http") ? rawSource : null,
      targetCityCodes: cityCodes,
      screeningStartDate: screeningStartDate instanceof Date ? screeningStartDate : null,
      screeningEndDate: screeningEndDate instanceof Date ? screeningEndDate : null,
      scanIntervalMinutes,
      wideOpenAlertPct,
      minShowsForAlert,
    },
  };
}

/** Every region the UI offers, for the city picker. */
export function selectableRegions() {
  return KERALA_REGIONS.map((r) => ({ code: r.code, name: r.name }));
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function num(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Dates arrive from a date input as "YYYY-MM-DD" and are interpreted as an IST calendar
 * day stored at midnight UTC — matching the @db.Date columns and the way show dates are
 * bucketed in normalize.ts. Anything else is an error rather than a silent coercion.
 */
function optionalDate(v: unknown): Date | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "invalid" : v;
  if (typeof v !== "string") return "invalid";
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "invalid";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) return "invalid";
  return d;
}

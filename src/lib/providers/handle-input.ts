import type { PlatformId } from "./types";

/**
 * Handle rules and the paste-a-list parser, deliberately in their own module.
 *
 * The validators used to live in platform-utils.ts next to contentProviderFor, which imports
 * the Apify and YouTube providers. That is fine for server code, but the bulk-add form is a
 * client component and needs the same rules to tell the user what it parsed *before* it spends
 * anything. Importing platform-utils there would drag the whole provider layer (and its
 * credential handling) into the client bundle. Everything in this file is pure and
 * dependency-free so both sides can share one definition instead of keeping two in sync;
 * platform-utils re-exports the validators, so existing call sites are untouched.
 */
export const PLATFORM_HANDLE_VALIDATORS: Record<PlatformId, { pattern: RegExp; label: string }> = {
  instagram: { pattern: /^[a-zA-Z0-9._]{1,30}$/, label: "Instagram" },
  youtube: { pattern: /^[a-zA-Z0-9._-]{3,30}$/, label: "YouTube" },
};

/**
 * Path segments that mean "this URL points at a piece of content, not at an account".
 *
 * Without these, `instagram.com/p/Cxyz123/` normalizes to the handle "p" — which passes the
 * handle pattern, so it would sail through validation and be sent to Apify as a real profile
 * scrape. A rejected line the user can see and fix costs nothing; a scrape of @p costs money
 * and silently adds a junk row that then gets refreshed forever.
 */
const INSTAGRAM_NON_ACCOUNT_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "s",
  "accounts",
  "direct",
]);

/** youtube.com/c/NAME, /user/NAME and /channel/ID all carry the identifier one segment deeper. */
const YOUTUBE_CONTAINER_SEGMENTS = new Set(["c", "user", "channel"]);

/**
 * One pasted line -> a bare handle, or null if the line cannot be one.
 *
 * Accepts what people actually paste: a bare handle, an @handle, or a profile URL copied out
 * of the address bar (with or without scheme, www, trailing slash, query string or fragment).
 * `addFanPage` only strips a leading "@", so without this every URL in a pasted list fails the
 * handle pattern with "not a valid Instagram handle" — which reads as the feature being broken
 * rather than as the input needing a trim.
 */
export function normalizeHandleInput(raw: string, platform: PlatformId): string | null {
  // Strip wrapping quotes/brackets and trailing list punctuation, which is what arrives when
  // a list is pasted out of a spreadsheet cell or a JSON array.
  let value = raw
    .trim()
    .replace(/^["'<([]+/, "")
    .replace(/["'>)\].,;]+$/, "")
    .trim();
  if (!value) return null;

  if (value.includes("/") || /^https?:/i.test(value) || /\b(?:instagram|youtube|youtu)\.[a-z.]+/i.test(value)) {
    value = handleFromUrl(value, platform) ?? "";
    if (!value) return null;
  }

  value = value.replace(/^@/, "").trim();
  if (!value) return null;
  return PLATFORM_HANDLE_VALIDATORS[platform].pattern.test(value) ? value : null;
}

function handleFromUrl(value: string, platform: PlatformId): string | null {
  // Parsed with the URL class rather than a regex, so query strings, fragments, ports and
  // percent-encoding are somebody else's solved problem. A scheme is added when missing,
  // because "instagram.com/foo" is not a URL to the parser but is exactly what people paste.
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`);
  } catch {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length === 0) return null;
  const first = segments[0].replace(/^@/, "");

  if (platform === "youtube") {
    // youtu.be links are per-video short links — there is no channel in them to track.
    if (/(?:^|\.)youtu\.be$/i.test(url.hostname)) return null;
    if (YOUTUBE_CONTAINER_SEGMENTS.has(segments[0].toLowerCase())) return segments[1]?.replace(/^@/, "") ?? null;
    return first;
  }

  if (INSTAGRAM_NON_ACCOUNT_SEGMENTS.has(first.toLowerCase())) return null;
  return first;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A lone "%" is legal in a pasted string and illegal to decode. Keep the raw segment and
    // let the handle pattern reject it, rather than throwing out of the whole parse.
    return segment;
  }
}

/**
 * How many handles one bulk-add Server Action call may carry, per platform.
 *
 * This is a wall-clock budget, not a preference. The action is bounded by the hosting page's
 * `maxDuration` (800s on /fan-pages), and the two platforms cost wildly different amounts of
 * that budget per handle:
 *
 * - Instagram: `scrapeByHandle` is TWO Apify runs (profile, then post history), each waiting up
 *   to DEFAULT_WAIT_MS (5 min) for the run to finish — so ~600s worst case for a single handle.
 *   Anything above 1 can exceed 800s and return a 504, which loses the results of the handles
 *   that already succeeded in that call. One per call is the only size that cannot.
 * - YouTube: the official Data API, answering in well under a second, with no Apify wait
 *   anywhere in the path. Batching these keeps a long channel list from becoming a long series
 *   of round-trips for no reason.
 *
 * The client chunks a pasted list by these numbers; the action enforces them, because a Server
 * Action is a public POST endpoint and the size of its input is not the client's to decide.
 */
export const BULK_ADD_CHUNK_SIZE: Record<PlatformId, number> = {
  instagram: 1,
  youtube: 10,
};

/** The largest chunk any platform may send — what the Server Action validates against. */
export const MAX_BULK_ADD_HANDLES = Math.max(...Object.values(BULK_ADD_CHUNK_SIZE));

export interface ParsedHandleList {
  /** Valid, de-duplicated handles, in the order they were pasted. */
  handles: string[];
  /** Lines that could not be read as a handle, kept verbatim so the user can spot the typo. */
  invalid: string[];
  /** How many lines were dropped as repeats of an earlier one. */
  duplicates: number;
}

/**
 * A whole pasted blob -> the handles to add.
 *
 * Split on line breaks, commas, semicolons and tabs, so one-per-line, comma-separated and
 * "pasted out of a spreadsheet column" all work without asking the user which format they are
 * using.
 *
 * Spaces are NOT separators, and that is the deliberate half. Splitting on whitespace looks
 * more forgiving and is worse: a line like `John Doe Fan Page` — a display name pasted next to
 * the handles, which is exactly what a copied spreadsheet gives you — becomes four "valid"
 * handles and four paid Apify scrapes of accounts nobody asked for. Treating that line as one
 * unreadable entry surfaces it in the invalid list where the user can see and fix it, at no
 * cost. Nothing is lost: no handle or profile URL contains a space, so a genuinely
 * space-separated list is not a format anyone produces.
 *
 * De-duplication is case-insensitive but preserves the casing of the first occurrence: both
 * platforms treat handles as case-insensitive for lookup and re-adding a page is a wasted paid
 * scrape, but silently rewriting what the user typed is not this function's business.
 */
export function parseHandleList(text: string, platform: PlatformId): ParsedHandleList {
  const handles: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const line of text.split(/[\r\n,;\t]+/)) {
    if (!line.trim()) continue;
    const handle = normalizeHandleInput(line, platform);
    if (!handle) {
      invalid.push(line.trim());
      continue;
    }
    const key = handle.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    handles.push(handle);
  }

  return { handles, invalid, duplicates };
}

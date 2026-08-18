// Normalizer for apify/facebook-pages-scraper — Scoutline's Facebook data source. Page-only
// (2026-08-18 direction: "not take the posts into account... based on the people talking
// about this"), not the two-actor pages+posts pipeline originally scoped.
//
// Field names confirmed against two live API runs against real pages (Marvel, 2026-08-18):
// `followers`/`likes` are plain numbers, but the one metric this whole approach depends on —
// Facebook's own "X people talking about this" (PTAT) figure — only comes back embedded in
// a free-text `info` array (e.g. "587,414 talking about this. The Official Facebook Page
// for..."), not as its own field. Parsed out with a regex; if the page's info text doesn't
// match that shape at all (a real, observed possibility — one of the three live test pages
// hit during verification came back with an empty dataset entirely, unrelated to this
// specific field but confirming Facebook scrapes are less consistently shaped than
// Instagram's), talkingAbout comes back null rather than a guessed value.
//
// PTAT has no published formula (it's Facebook's own internal metric), so it's used here as
// an engagement *proxy* — engagementRatePct = talkingAbout / followers * 100 — not a like/
// comment/share-based rate the way Instagram's actor computes. No post-level data means
// consistency and content-mix are always null for Facebook snapshots, same "exclude rather
// than fake" discipline scoreInfluencer.ts already has for any missing signal.

type ActorItem = Record<string, unknown>;

function str(item: ActorItem, key: string): string | null {
  const v = item[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(item: ActorItem, key: string): number | null {
  const v = item[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const TALKING_ABOUT_RE = /([\d,]+)\s+(?:people\s+)?talking about this/i;

function parseTalkingAbout(item: ActorItem): number | null {
  const info = item["info"];
  if (!Array.isArray(info)) return null;
  for (const line of info) {
    if (typeof line !== "string") continue;
    const m = line.match(TALKING_ABOUT_RE);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export interface NormalizedFacebookScoutItem {
  pageUsername: string | null;
  followers: number | null;
  followersAvailable: boolean;
  talkingAbout: number | null;
  category: string | null;
  note: string | null;
  raw: ActorItem;
}

export function normalizeFacebookScoutItem(item: ActorItem): NormalizedFacebookScoutItem {
  const followers = num(item, "followers") ?? num(item, "likes");
  const talkingAbout = parseTalkingAbout(item);
  return {
    pageUsername: str(item, "pageName") ?? str(item, "title"),
    followers,
    followersAvailable: followers !== null,
    talkingAbout,
    category: str(item, "category"),
    note: talkingAbout === null ? "no 'talking about this' figure found for this page" : null,
    raw: item,
  };
}

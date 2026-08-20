#!/usr/bin/env node
/**
 * Local BookMyShow capture for Theater Campaign Intelligence.
 *
 * Drives the REAL Chrome installed on this machine, over this machine's own connection, to
 * read public showtime pages, then POSTs the findings to StarAnalytics.
 *
 * WHY THIS EXISTS. BookMyShow's edge blocks automated clients: an Apify headless browser on
 * a datacenter proxy is refused with 403, as is plain `curl` — while a real browser on the
 * same connection loads the page fine. See BOOKMYSHOW-FEASIBILITY.md §8. Server-side
 * collection is therefore not available, and this is what remains.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, and must never be changed to do:
 *   - no stealth plugin, no fingerprint patching, no navigator.webdriver spoofing
 *   - no user-agent override
 *   - no proxy, and above all no residential proxy rotation
 *   - no CAPTCHA solving, no retry-until-through loop
 *
 * It works because it IS an ordinary browser, not because it is disguised as one. That
 * distinction is the entire ethical basis for this path. If BookMyShow ever blocks this
 * too, the correct response is to STOP and pursue authorized access — not to start
 * pretending.
 *
 * It also stays at human-scale volume on purpose: a small number of target cities, a
 * couple of dates, a pause between page loads, and a hard cap on runs per day (enforced
 * again on the server, because a client-side limit is only a suggestion).
 *
 * Usage:
 *   node scripts/bms-capture.mjs --campaign <campaignId>
 *   node scripts/bms-capture.mjs --campaign <id> --cities KOCH,PLKK --days 2 --dry-run
 *
 * Environment (a .env.local next to the project root is read automatically):
 *   STARANALYTICS_URL           default http://localhost:3000
 *   BOOKMYSHOW_CAPTURE_SECRET   must match the server's
 *   BOOKMYSHOW_CAPTURE_CITIES   default: the campaign's own configured cities
 *   BOOKMYSHOW_CAPTURE_DAYS     default 2
 *   BOOKMYSHOW_CAPTURE_DELAY_MS default 4000
 */

import { chromium } from "playwright";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- config -----------------------------------------------------------------

loadEnvFile(join(ROOT, ".env.local"));

const args = parseArgs(process.argv.slice(2));
const CAMPAIGN_ID = args.campaign || process.env.BOOKMYSHOW_CAPTURE_CAMPAIGN;
const BASE_URL = (args.url || process.env.STARANALYTICS_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.BOOKMYSHOW_CAPTURE_SECRET;
const DAYS = Number(args.days || process.env.BOOKMYSHOW_CAPTURE_DAYS || 2);
const DELAY_MS = Number(args["delay-ms"] || process.env.BOOKMYSHOW_CAPTURE_DELAY_MS || 4000);
const DRY_RUN = Boolean(args["dry-run"]);
const HEADFUL = !args.headless;
const LOG_FILE = join(ROOT, "bms-capture.log");

if (!CAMPAIGN_ID) fail("Missing --campaign <campaignId> (or BOOKMYSHOW_CAPTURE_CAMPAIGN).");
if (!SECRET && !DRY_RUN) fail("Missing BOOKMYSHOW_CAPTURE_SECRET — must match the server's value.");

/**
 * Kerala regions. Mirrors src/lib/bookmyshow/urls.ts.
 *
 * Duplicated rather than imported: this script runs as plain node against a checkout with
 * no build step, and importing a TypeScript module from src/ would mean adding a
 * transpiler to something whose whole value is that it is a single file you can schedule.
 * Region codes change about as often as Kerala gains a district.
 */
const REGIONS = {
  KOCH: ["kochi", "Kochi", "9.9312328", "76.2673041"],
  TRIV: ["thiruvananthapuram-trivandrum", "Thiruvananthapuram", "8.5241", "76.9366"],
  THSR: ["thrissur", "Thrissur", "10.5276", "76.2144"],
  KOZH: ["kozhikode", "Kozhikode", "11.2588", "75.7804"],
  KOLM: ["kollam", "Kollam", "8.8932", "76.6141"],
  ALPZ: ["alappuzha", "Alappuzha", "9.4981", "76.3388"],
  KTYM: ["kottayam", "Kottayam", "9.5916", "76.5222"],
  KANN: ["kannur", "Kannur", "11.8745", "75.3704"],
  PLKK: ["palakkad", "Palakkad", "10.7867", "76.6548"],
  PNTM: ["perinthalmanna", "Perinthalmanna", "10.9757", "76.2265"],
  THOD: ["thodupuzha", "Thodupuzha", "9.8956", "76.7183"],
  MUVA: ["muvattupuzha", "Muvattupuzha", "9.9894", "76.5790"],
  PTNM: ["pathanamthitta", "Pathanamthitta", "9.2648", "76.7870"],
  THVL: ["thiruvalla", "Thiruvalla", "9.3833", "76.5741"],
  MAJR: ["manjeri", "Manjeri", "11.1200", "76.1200"],
  ANGA: ["angamaly", "Angamaly", "10.1960", "76.3860"],
  IRNK: ["irinjalakuda", "Irinjalakuda", "10.3417", "76.2114"],
  KUNN: ["kunnamkulam", "Kunnamkulam", "10.6500", "76.0700"],
  OTTP: ["ottapalam", "Ottapalam", "10.7700", "76.3770"],
  PALL: ["pala", "Pala", "9.7140", "76.6860"],
  CNSY: ["changanassery", "Changanassery", "9.4450", "76.5400"],
  KAYA: ["kayamkulam", "Kayamkulam", "9.1800", "76.5000"],
  KTMM: ["kothamangalam", "Kothamangalam", "10.0600", "76.6300"],
  VDKR: ["vadakara", "Vadakara", "11.6000", "75.5900"],
  THAY: ["thalassery", "Thalassery", "11.7500", "75.4900"],
  TALI: ["taliparamba", "Taliparamba", "12.0400", "75.3600"],
  KKNN: ["kanhangad", "Kanhangad", "12.3100", "75.0900"],
  PUNA: ["punalur", "Punalur", "9.0100", "76.9300"],
  KARR: ["kallara", "Kallara", "8.7000", "76.9000"],
  GOOL: ["goolikkadavu", "Goolikkadavu", "9.1000", "76.6000"],
};

// --- main -------------------------------------------------------------------

const plan = await fetchPlan();
const cities = resolveCities(plan);
const dates = nextIstDates(DAYS);

log(`capture start campaign=${CAMPAIGN_ID} cities=${cities.length} dates=${dates.length} pages=${cities.length * dates.length}`);

if (cities.length === 0) fail("No cities resolved — check --cities or the campaign's configuration.");

const browser = await chromium.launch({ channel: "chrome", headless: !HEADFUL });
const context = await browser.newContext({ locale: "en-IN", timezoneId: "Asia/Kolkata" });

const items = [];
let ok = 0;
let failed = 0;

try {
  for (const code of cities) {
    for (const date of dates) {
      const dateCode = toDateCode(date);
      const item = await capturePage(context, plan, code, dateCode);
      items.push(item);
      if (item.error) {
        failed++;
        log(`  ${code} ${dateCode} -> FAILED: ${item.error}`);
      } else {
        ok++;
        log(`  ${code} ${dateCode} -> ${item.venues.length} venues, ${countShows(item)} shows`);
      }
      // Pacing. This is politeness and rate-limiting, not evasion: it keeps a full sweep
      // at roughly the request rate of one person browsing.
      await sleep(DELAY_MS);
    }
  }
} finally {
  await browser.close();
}

log(`capture done ok=${ok} failed=${failed}`);

if (DRY_RUN) {
  console.log(JSON.stringify(summarise(items), null, 1));
  log("dry run — nothing posted");
  process.exit(0);
}

// A sweep where nothing at all loaded is almost certainly a block or an outage, not a
// state of the world. Posting it would write a wall of failed-city rows; better to exit
// loudly and leave yesterday's data standing.
if (ok === 0) {
  fail("Every page failed. Not posting. If this persists, BookMyShow may have started blocking this path — stop and reassess rather than retrying.");
}

const res = await fetch(`${BASE_URL}/api/theater-campaigns/${CAMPAIGN_ID}/ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-capture-secret": SECRET },
  body: JSON.stringify({ items, requested: cities.length * dates.length }),
});

const bodyText = await res.text();
if (!res.ok) {
  fail(`ingest failed (${res.status}): ${bodyText.slice(0, 300)}`);
}
log(`ingest ok: ${bodyText.slice(0, 300)}`);

// --- helpers ----------------------------------------------------------------

/**
 * Ask the server what to scan.
 *
 * The event code and city list live on the campaign, so the script does not hold a second
 * copy that could drift. Falls back to CLI/env values if the endpoint is unreachable, so a
 * scheduled run is not entirely dependent on the app being up.
 */
async function fetchPlan() {
  const fallback = {
    eventCode: args["event-code"] || process.env.BOOKMYSHOW_CAPTURE_EVENT_CODE,
    movieSlug: args["movie-slug"] || process.env.BOOKMYSHOW_CAPTURE_MOVIE_SLUG,
    cityCodes: null,
  };
  if (DRY_RUN && fallback.eventCode) return fallback;

  try {
    const res = await fetch(`${BASE_URL}/api/theater-campaigns/${CAMPAIGN_ID}/capture-plan`, {
      headers: { "x-capture-secret": SECRET ?? "" },
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    return await res.json();
  } catch (err) {
    if (fallback.eventCode) {
      log(`could not reach capture-plan (${err.message}); using --event-code fallback`);
      return fallback;
    }
    fail(`could not fetch capture plan: ${err.message}`);
  }
}

function resolveCities(plan) {
  const raw = args.cities || process.env.BOOKMYSHOW_CAPTURE_CITIES;
  const requested = raw
    ? raw.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : plan.cityCodes && plan.cityCodes.length
      ? plan.cityCodes
      : Object.keys(REGIONS);
  const unknown = requested.filter((c) => !REGIONS[c]);
  if (unknown.length) log(`ignoring unknown region codes: ${unknown.join(", ")}`);
  return requested.filter((c) => REGIONS[c]);
}

async function capturePage(context, plan, code, dateCode) {
  const [slug, name, lat, long] = REGIONS[code];
  const city = `${code.toLowerCase()}:${slug}`;
  const url = `https://in.bookmyshow.com/movies/${city}/${plan.movieSlug}-${city}/buytickets/${plan.eventCode}/${dateCode}`;

  // BookMyShow resolves the display region from this cookie, NOT from the URL — without
  // setting it per page, every request returns whichever city was set last. It is a
  // first-party city preference, the same thing clicking the city picker writes.
  await context.clearCookies({ name: "rgn" }).catch(() => {});
  await context.addCookies([
    {
      name: "rgn",
      value: encodeURIComponent(
        JSON.stringify({
          regionNameSlug: slug,
          regionCodeSlug: code.toLowerCase(),
          regionName: name,
          regionCode: code,
          subName: "",
          subCode: "",
          Lat: lat,
          Long: long,
          countryCode: "IN",
          GeoHash: "t9y",
        }),
      ),
      domain: "in.bookmyshow.com",
      path: "/",
    },
  ]);

  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = resp ? resp.status() : 0;
    if (status >= 400) {
      return { cityCode: code, showDateCode: dateCode, url, error: `HTTP ${status}` };
    }

    await page
      .waitForFunction(
        () => {
          const s = window.__INITIAL_STATE__;
          return (
            s &&
            s.showtimesFunctionalApi &&
            Object.keys(s.showtimesFunctionalApi.queries || {}).some((k) => /Dynamic/i.test(k))
          );
        },
        { timeout: 45000 },
      )
      .catch(() => {});

    const extracted = await page.evaluate(extractFromPage);
    return { cityCode: code, showDateCode: dateCode, url, ...extracted };
  } catch (err) {
    return { cityCode: code, showDateCode: dateCode, url, error: String(err.message || err).slice(0, 200) };
  } finally {
    await page.close();
  }
}

/**
 * Runs in the page. Returns the same shape src/lib/bookmyshow/types.ts calls a
 * BmsScrapeItem, so the server can hand it straight to the existing normalizer.
 *
 * Extracts a compact summary rather than the whole hydration state: that blob is large and
 * carries a lot of BookMyShow's UI configuration we have no business storing.
 */
function extractFromPage() {
  const out = {};
  const S = window.__INITIAL_STATE__;
  if (!S || !S.showtimesFunctionalApi) {
    out.error = "showtime state never hydrated";
    return out;
  }
  const queries = S.showtimesFunctionalApi.queries || {};
  const key = Object.keys(queries).filter((k) => /Dynamic/i.test(k)).pop();
  if (!key) {
    out.error = "no dynamic showtime query";
    return out;
  }
  // The region the page ACTUALLY served, which the server asserts against what we asked
  // for. BookMyShow silently serves the cookie's city regardless of the URL.
  out.queryKey = key;

  const data = queries[key] && queries[key].data && queries[key].data.data;
  const widgets = (data && data.showtimeWidgets) || [];
  const group = widgets.filter((w) => w.type === "groupList")[0];
  if (!group) {
    out.venues = [];
    return out;
  }

  const venues = [];
  Object.keys(group.data || {}).forEach((gk) => {
    const g = group.data[gk];
    Object.keys(g.data || {}).forEach((vk) => {
      const v = g.data[vk];
      const shows = [];
      (v.showtimesSections || []).forEach((sec) => {
        (sec.showtimes || []).forEach((sh) => {
          const ad = sh.additionalData || {};
          const an = (sh.cta && sh.cta.analytics) || {};
          shows.push({
            title: sh.title,
            styleId: sh.styleId,
            subtitleAcronym: sh.subtitleAcronym,
            filters: sh.filters,
            additionalData: {
              sessionId: ad.sessionId,
              availStatus: ad.availStatus,
              showDateTime: ad.showDateTime,
              showDateCode: ad.showDateCode,
              showTime: ad.showTime,
              cutOffDateTimeEpoch: ad.cutOffDateTimeEpoch,
            },
            cta: {
              analytics: {
                company_code: an.company_code,
                show_session_id: an.show_session_id,
                metadata: an.metadata,
              },
            },
          });
        });
      });
      venues.push({
        id: v.id,
        additionalData: {
          venueCode: v.additionalData && v.additionalData.venueCode,
          venueName: v.additionalData && v.additionalData.venueName,
        },
        analytics: { company_code: v.analytics && v.analytics.company_code },
        showtimesSections: [{ showtimes: shows }],
      });
    });
  });
  out.venues = venues;
  return out;
}

/** The next N IST calendar days, as midnight-UTC dates. */
function nextIstDates(n) {
  const IST_MS = (5 * 60 + 30) * 60_000;
  const shifted = new Date(Date.now() + IST_MS);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(start + i * 86_400_000));
}

function toDateCode(d) {
  return (
    d.getUTCFullYear() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0")
  );
}

function countShows(item) {
  return (item.venues || []).reduce(
    (t, v) => t + (v.showtimesSections || []).reduce((s, sec) => s + (sec.showtimes || []).length, 0),
    0,
  );
}

function summarise(items) {
  const avail = {};
  let venues = 0;
  let shows = 0;
  for (const item of items) {
    for (const v of item.venues || []) {
      venues++;
      for (const sec of v.showtimesSections || []) {
        for (const sh of sec.showtimes || []) {
          shows++;
          const a = sh.additionalData && sh.additionalData.availStatus;
          avail[a] = (avail[a] || 0) + 1;
        }
      }
    }
  }
  return { pages: items.length, failed: items.filter((i) => i.error).length, venues, shows, avail };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** Minimal .env.local reader — avoids a dependency for five variables. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  // A scheduled task runs with no console attached, so the log file is the only record of
  // what happened at 09:00 while nobody was watching.
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* logging must never break a capture */
  }
}

function fail(message) {
  log(`ERROR: ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

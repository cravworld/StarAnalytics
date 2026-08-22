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
 *   node scripts/bms-capture.mjs --campaign <id> --sweep --days 1      # all of Kerala, ~40 min
 *   node scripts/bms-capture.mjs --campaign <id> --cities KOCH,PLKK --days 2 --dry-run
 *
 * --sweep reads EVERY city rather than one burst's worth. BookMyShow serves about four to
 * six pages and then refuses; a five-minute pause restores it. So a sweep is simply slow,
 * not clever — it waits the throttle out in the same browser session rather than changing
 * anything about who it appears to be.
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
// Skip the days that are too late to act on. A show tonight cannot absorb a campaign push;
// reading it spends a request on data nobody can use. See nextIstDates.
const DAYS_FROM = Number(args["days-from"] || process.env.BOOKMYSHOW_CAPTURE_DAYS_FROM || 0);
const DELAY_MS = Number(args["delay-ms"] || process.env.BOOKMYSHOW_CAPTURE_DELAY_MS || 4000);
const MAX_CITIES = Number(args["max-cities"] || process.env.BOOKMYSHOW_CAPTURE_MAX_CITIES || 0);
// Sweep mode: read every city, pacing around BookMyShow's burst allowance instead of
// settling for whatever one burst returns. Batch size is set just under the measured
// allowance (4-6 pages) and the pause just over the measured recovery (5 min).
const SWEEP = Boolean(args.sweep);
const BATCH_SIZE = Number(args["batch-size"] || process.env.BOOKMYSHOW_CAPTURE_BATCH_SIZE || 4);
const BATCH_PAUSE_MS = Number(args["batch-pause-ms"] || process.env.BOOKMYSHOW_CAPTURE_BATCH_PAUSE_MS || 300_000);
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

// Stop before opening a browser if the server will not accept the result anyway.
//
// The daily cap is enforced at ingest, which is the worst moment to discover it: the pages
// have already been fetched from BookMyShow and the whole run is then discarded with a 429.
// Requests spent, nothing learned. Checking here is the same principle as capping the city
// window — do not send requests whose outcome is already decided.
//
// Advisory only. The server remains the thing that enforces the cap, so editing this out
// buys nothing except a wasted run.
if (!DRY_RUN && typeof plan.pagesRemaining === "number" && plan.pagesRemaining <= 0) {
  fail(
    "Daily page limit already reached for this campaign, so this run would be rejected. " +
      "Nothing was requested from BookMyShow. Try again later — the limit is a rolling 24 hours, " +
      "not a calendar day, so the earliest slot frees up 24h after the oldest run.",
  );
}

const cities = resolveCities(plan);
const dates = nextIstDates(DAYS, DAYS_FROM);

log(`capture start campaign=${CAMPAIGN_ID} cities=${cities.length} dates=${dates.length} pages=${cities.length * dates.length}`);

if (cities.length === 0) fail("No cities resolved — check --cities or the campaign's configuration.");

const browser = await chromium.launch({ channel: "chrome", headless: !HEADFUL });
const context = await browser.newContext({ locale: "en-IN", timezoneId: "Asia/Kolkata" });

const items = [];
let ok = 0;
let failed = 0;

/**
 * One page, recorded.
 *
 * Returns true when the page was read, so the batch loop can tell a pacing clamp (several
 * refusals in a row) from an ordinary partial result.
 */
async function runOne(code, dateCode) {
  const item = await capturePage(context, plan, code, dateCode);
  items.push(item);
  if (item.error) {
    failed++;
    log(`  ${code} ${dateCode} -> FAILED: ${item.error}`);
    return false;
  }
  ok++;
  log(`  ${code} ${dateCode} -> ${item.venues.length} venues, ${countShows(item)} shows`);
  return true;
}

// Every city-date this run intends to read.
const targets = [];
for (const code of cities) {
  for (const date of dates) targets.push({ code, dateCode: toDateCode(date) });
}

try {
  if (!SWEEP) {
    for (const t of targets) {
      await runOne(t.code, t.dateCode);
      // Pacing. This is politeness and rate-limiting, not evasion: it keeps a full sweep
      // at roughly the request rate of one person browsing.
      await sleep(DELAY_MS);
    }
  } else {
    // Paced sweep: read everything, slowly enough that BookMyShow keeps serving.
    //
    // Measured 2026-08-20. BookMyShow allows a burst of roughly four to six pages and then
    // refuses with 403; a five-minute pause in the SAME browser session restores it
    // completely (6 pages, pause, 6 more, 12/12 at 200). So the limit is about pace, not
    // about how much a client may ever read.
    //
    // Waiting one out is what a well-behaved client does — it is the response the 403 is
    // asking for. Nothing here changes identity to get more: same browser, same cookie jar,
    // no proxy, no user-agent games, and each page is attempted at most twice. Widening the
    // per-burst yield is the thing that would be wrong, and this does the opposite.
    const batches = [];
    for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE));
    const totalMinutes = Math.round(((batches.length - 1) * BATCH_PAUSE_MS + targets.length * DELAY_MS) / 60000);
    log(
      `sweep: ${targets.length} pages in ${batches.length} batches of ${BATCH_SIZE}, ` +
        `${Math.round(BATCH_PAUSE_MS / 60000)} min between batches — expect roughly ${totalMinutes} minutes`,
    );

    const retry = [];
    let emptyBatches = 0;

    for (let b = 0; b < batches.length; b++) {
      log(`batch ${b + 1}/${batches.length}`);
      let batchOk = 0;
      for (const t of batches[b]) {
        if (await runOne(t.code, t.dateCode)) batchOk++;
        else retry.push(t);
        await sleep(DELAY_MS);
      }

      // Two batches in a row with nothing at all means this is no longer pacing — waiting
      // longer is not going to fix a refusal that is now unconditional. Stop and say so
      // rather than working through the remaining batches for nothing.
      emptyBatches = batchOk === 0 ? emptyBatches + 1 : 0;
      if (emptyBatches >= 2) {
        log("two consecutive batches returned nothing — stopping the sweep rather than continuing to ask.");
        break;
      }

      if (b < batches.length - 1) {
        log(`  pausing ${Math.round(BATCH_PAUSE_MS / 60000)} min to let the allowance recover...`);
        await sleep(BATCH_PAUSE_MS);
      }
    }

    // One retry pass. A 403 here meant "not right now", and the pauses have since proved
    // that recovers, so a single deferred attempt is reasonable.
    // One pass, never a loop: retrying until something gets through is an attack.
    if (retry.length > 0 && emptyBatches < 2) {
      log(`retry pass: ${retry.length} page(s) that were refused earlier`);
      const retryBatches = [];
      for (let i = 0; i < retry.length; i += BATCH_SIZE) retryBatches.push(retry.slice(i, i + BATCH_SIZE));
      for (let b = 0; b < retryBatches.length; b++) {
        log(`  retry batch ${b + 1}/${retryBatches.length}`);
        for (const t of retryBatches[b]) {
          await runOne(t.code, t.dateCode);
          await sleep(DELAY_MS);
        }
        if (b < retryBatches.length - 1) await sleep(BATCH_PAUSE_MS);
      }
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
  const known = requested.filter((c) => REGIONS[c]);
  if (raw) return known; // an explicit --cities list is an instruction, not a suggestion
  // A sweep reads everything by pacing itself, so there is nothing to choose between.
  if (SWEEP) return known;

  // The server orders districts stalest-first, so taking the front of the list continues
  // where the last run stopped — no state kept here, and a district whose last read failed
  // comes back around quickly instead of waiting a full cycle.
  //
  // rotateWindow is the fallback for when there is no plan to order (an --event-code run
  // with no server reachable). A clock-derived rotation cannot know what actually landed.
  if (plan.orderedByStaleness) {
    const take = MAX_CITIES > 0 ? Math.min(MAX_CITIES, known.length) : known.length;
    const picked = known.slice(0, take);
    if (take < known.length) {
      log(`districts (stalest first, ${take} of ${known.length}): ${picked.join(", ")}`);
    }
    return picked;
  }
  return rotateWindow(known);
}

/**
 * Take a different slice of the city list on each run.
 *
 * WHY. Measured twice on 2026-08-20, 17 minutes apart: the first page of a run succeeds and
 * every page after it returns 403. Because the city list arrives in a fixed order, that
 * means a scheduled task requesting all 30 regions captures Kochi, three times a day,
 * forever — and never sees the other 29. The campaign is supposed to cover Kerala.
 *
 * This does NOT try to get more pages than BookMyShow is willing to serve. The yield stays
 * one city per run; all that changes is WHICH city gets that slot, and that 29 requests
 * already known to be refused are no longer sent. Fewer requests, same result — the
 * opposite of working around a rate limit.
 *
 * The offset comes from the clock rather than a state file so nothing has to be persisted
 * between runs, and the 09:00/14:00/19:00 triggers are 5 hours apart, so each lands in its
 * own bucket and the window advances every time.
 */
function rotateWindow(cities) {
  if (cities.length === 0) return cities;
  const size = MAX_CITIES > 0 ? Math.min(MAX_CITIES, cities.length) : cities.length;
  // Advance by ONE city per run, not by the window size. Sliding by the window looks
  // tidier and is wrong: with 30 regions and a window of 6, `bucket * 6 % 30` only ever
  // takes 5 distinct values, so only 5 cities would ever lead — and since only the lead
  // page succeeds, only those 5 would ever be captured. Stepping by 1 gives every region
  // the leading slot in turn (gcd(1, n) = 1, so the cycle covers all of them).
  const bucket = Math.floor(Date.now() / (5 * 60 * 60 * 1000));
  const start = ((bucket % cities.length) + cities.length) % cities.length;
  const window = [];
  for (let i = 0; i < size; i++) window.push(cities[(start + i) % cities.length]);
  if (size < cities.length) {
    log(`city window ${start}..${start + size - 1} of ${cities.length}: ${window.join(", ")}`);
  }
  return window;
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
/**
 * The date window to read, FURTHEST DAY FIRST.
 *
 * Two decisions here, both load-bearing.
 *
 * `from` skips the days that are too late to act on. A show tonight or tomorrow cannot
 * absorb a campaign push in time, so reading them spends requests on data nobody can use.
 * The launcher starts at day+2.
 *
 * The order is descending because BookMyShow serves the first page or two of a burst and
 * refuses the rest — measured 2026-08-22: day+2 requested FIRST returned 200 with 18 shows,
 * while requests two and three of the same session were both refused. Walking dates
 * ascending therefore starved the furthest day permanently: it was always last, so it was
 * always the one refused. The numbers were stark — 93% capture for day 0 against 27% for
 * day+2, and only 83 screenings for the far date against 682 for the near one.
 *
 * Furthest-first also self-heals rather than merely swapping who starves: today's day+3 is
 * tomorrow's day+2, so a date refused in the second slot gets the first slot on the next
 * run, when the window has slid forward one day.
 */
function nextIstDates(n, from = 0) {
  const IST_MS = (5 * 60 + 30) * 60_000;
  const shifted = new Date(Date.now() + IST_MS);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(start + (from + n - 1 - i) * 86_400_000));
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

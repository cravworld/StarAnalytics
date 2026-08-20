// Live BookMyShow provider, via an Apify browser actor.
//
// UNVERIFIED AGAINST A REAL RUN AT TIME OF WRITING. `apify/web-scraper` and
// `apify/puppeteer-scraper` both return `403 full-permission-actor-not-approved` until
// someone approves the actor's permissions once in the Apify console, so this code path
// has never executed end-to-end. Two things are therefore still open, and both are called
// out again in BOOKMYSHOW-FEASIBILITY.md §8:
//
//   1. Whether BookMyShow serves these pages to a datacenter IP at all. Every observation
//      behind this feature was made from a residential browser.
//   2. Whether `preNavigationHooks` sets the region cookie early enough to take effect.
//
// Until a run succeeds, treat this file as a considered proposal rather than working code.
// The mock provider is what the rest of the system is built and tested against.
//
// Compliance, restated here because this is the file that actually makes requests:
// we render the public showtime page and read the state it hydrates into the DOM. We do
// NOT call BookMyShow's internal XHR endpoints directly — /getJSData/ and /getHTML* are
// robots-disallowed, and rendering the permitted page is the line the whole compliance
// position rests on. Do not "optimize" this into a direct API call.

import { getDatasetItems, runActor, waitForRun } from "@/lib/apify/client";
import { assertQuotaCircuitClosed, isAccountBudgetExhausted, QUOTA_ERROR_MARKER } from "@/lib/apify/quotaBreaker";
import { prisma } from "@/lib/prisma";
import { buildRegionCookieValue, buildShowtimeUrl, regionByCode } from "../urls";
import type { BmsScrapeItem, BookMyShowProvider } from "../types";

/** Which actor backs the live provider. Overridable without a redeploy. */
export function bookMyShowActorId(): string {
  return process.env.APIFY_ACTOR_BOOKMYSHOW || "apify/web-scraper";
}

/**
 * Runs in the page. Reads the hydrated showtime state and returns a compact summary —
 * deliberately NOT the whole payload: it is large, and shipping it wholesale into our
 * dataset would store far more third-party data than this feature needs.
 */
const PAGE_FUNCTION = `async function pageFunction(context) {
  var request = context.request;
  var ud = (request && request.userData) || {};
  var out = { cityCode: ud.cityCode, showDateCode: ud.showDateCode, url: location.href };

  for (var i = 0; i < 45; i++) {
    var s = window.__INITIAL_STATE__;
    if (s && s.showtimesFunctionalApi &&
        Object.keys(s.showtimesFunctionalApi.queries || {}).some(function (k) { return /Dynamic/i.test(k); })) break;
    await new Promise(function (r) { setTimeout(r, 1000); });
  }

  var S = window.__INITIAL_STATE__;
  if (!S || !S.showtimesFunctionalApi) {
    out.error = "showtime state never hydrated";
    return out;
  }
  var queries = S.showtimesFunctionalApi.queries || {};
  var entry = Object.keys(queries).filter(function (k) { return /Dynamic/i.test(k); }).pop();
  if (!entry) { out.error = "no dynamic showtime query"; return out; }
  out.queryKey = entry;

  var data = queries[entry] && queries[entry].data && queries[entry].data.data;
  var widgets = (data && data.showtimeWidgets) || [];
  var group = widgets.filter(function (w) { return w.type === "groupList"; })[0];
  if (!group) { out.venues = []; return out; }

  var venues = [];
  Object.keys(group.data || {}).forEach(function (gk) {
    var g = group.data[gk];
    Object.keys(g.data || {}).forEach(function (vk) {
      var v = g.data[vk];
      var shows = [];
      (v.showtimesSections || []).forEach(function (sec) {
        (sec.showtimes || []).forEach(function (sh) {
          var ad = sh.additionalData || {};
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
              cutOffDateTimeEpoch: ad.cutOffDateTimeEpoch
            },
            cta: { analytics: {
              company_code: sh.cta && sh.cta.analytics && sh.cta.analytics.company_code,
              show_session_id: sh.cta && sh.cta.analytics && sh.cta.analytics.show_session_id,
              metadata: sh.cta && sh.cta.analytics && sh.cta.analytics.metadata
            } }
          });
        });
      });
      venues.push({
        id: v.id,
        additionalData: {
          venueCode: v.additionalData && v.additionalData.venueCode,
          venueName: v.additionalData && v.additionalData.venueName
        },
        analytics: { company_code: v.analytics && v.analytics.company_code },
        showtimesSections: [{ showtimes: shows }]
      });
    });
  });
  out.venues = venues;
  return out;
}`;

/**
 * Sets the per-request region cookie before navigation.
 *
 * This is the whole reason a single run can cover many cities: BookMyShow resolves the
 * display region from `rgn`, and the actor's run-level `initialCookies` are global, so a
 * shared cookie would make every page return the same city. Per-request is the only shape
 * that works.
 */
const PRE_NAVIGATION_HOOKS = `[
  async (crawlingContext) => {
    const { page, request } = crawlingContext;
    const rgn = request.userData && request.userData.rgn;
    if (page && rgn) {
      await page.setCookie({ name: "rgn", value: rgn, domain: "in.bookmyshow.com", path: "/" });
    }
  }
]`;

export class ApifyBookMyShowProvider implements BookMyShowProvider {
  readonly name = "apify" as const;

  async fetchShowtimes(opts: {
    eventCode: string;
    movieSlug: string;
    regionCodes: string[];
    dates: Date[];
  }): Promise<BmsScrapeItem[]> {
    const actorId = bookMyShowActorId();
    // Before any scrape_runs row: a skipped call never reached Apify, so recording one
    // would falsify the audit trail the circuit breaker itself reads from.
    await assertQuotaCircuitClosed(actorId);

    const startUrls: { url: string; userData: Record<string, string> }[] = [];
    for (const code of opts.regionCodes) {
      const region = regionByCode(code);
      if (!region) continue;
      for (const date of opts.dates) {
        startUrls.push({
          url: buildShowtimeUrl({ region, movieSlug: opts.movieSlug, eventCode: opts.eventCode, date }),
          userData: {
            cityCode: region.code,
            showDateCode: toDateCode(date),
            rgn: buildRegionCookieValue(region),
          },
        });
      }
    }
    if (startUrls.length === 0) return [];

    const input = {
      startUrls,
      pageFunction: PAGE_FUNCTION,
      preNavigationHooks: PRE_NAVIGATION_HOOKS,
      // No proxy. If BookMyShow declines plain datacenter traffic, that is an answer we
      // need to see and act on, not something to paper over — rotating residential proxies
      // to look like organic users is exactly the evasion this project ruled out.
      proxyConfiguration: { useApifyProxy: false },
      maxRequestsPerCrawl: startUrls.length,
      maxConcurrency: MAX_CONCURRENCY,
      headless: true,
      injectJQuery: false,
      waitUntil: ["networkidle2"],
      pageLoadTimeoutSecs: 90,
    };

    const run = await prisma.scrapeRun.create({ data: { kind: "bookmyshow", status: "queued" } });
    try {
      const { runId, datasetId } = await runActor(actorId, input, {
        maxChargeUsd: chargeCapFor(startUrls.length),
        timeoutSecs: Math.ceil(WAIT_MS / 1000) + 60,
      });
      await prisma.scrapeRun.update({
        where: { id: run.id },
        data: { status: "running", apifyRunId: runId, startedAt: new Date() },
      });

      const finished = await waitForRun(runId, { timeoutMs: WAIT_MS });
      if (finished.status !== "SUCCEEDED") {
        // A run that started legally and then died can be the monthly cap being reached
        // mid-flight; Apify reports that as a bare ABORTED with no quota marker, which the
        // 403 breaker structurally cannot see. Ask the account and stamp the marker here.
        const quotaHit = await isAccountBudgetExhausted();
        const error = quotaHit
          ? `Apify run ended with status ${finished.status} — account budget exhausted (${QUOTA_ERROR_MARKER})`
          : `Apify run ended with status ${finished.status}`;
        await prisma.scrapeRun.update({
          where: { id: run.id },
          data: { status: "error", finishedAt: new Date(), error },
        });
        throw new Error(error);
      }

      const items = await getDatasetItems<BmsScrapeItem>(finished.datasetId || datasetId);
      await prisma.scrapeRun.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date(), itemCount: items.length },
      });
      return items;
    } catch (err) {
      await prisma.scrapeRun.update({
        where: { id: run.id },
        data: {
          status: "error",
          finishedAt: new Date(),
          // Message only. Never the input — it carries the region cookie, and while that
          // is only a city preference, error columns are read in logs and exports and are
          // the wrong place for anything request-shaped.
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }
}

/**
 * Concurrency inside one run. Kept low deliberately: this is a third party's site being
 * rendered on their infrastructure's behalf, and a Kerala-wide scan is already ~90 page
 * loads. Politeness here is also self-interest — a burst is the thing most likely to get
 * this blocked.
 */
const MAX_CONCURRENCY = Number(process.env.BOOKMYSHOW_SCAN_CONCURRENCY) || 3;

/** Wait budget for one scan run. Callers must keep their route maxDuration above this. */
const WAIT_MS = Number(process.env.BOOKMYSHOW_RUN_WAIT_MS) || 8 * 60 * 1000;

/**
 * Per-run spend ceiling, enforced by Apify itself.
 *
 * Browser-actor pricing is per compute unit rather than per item, so this is sized from
 * page count with generous headroom rather than being a precise cost model. It is a
 * runaway guard, not a budget: a cap that truncates a legitimate Kerala-wide scan would
 * silently produce a partial picture, which is worse than spending a few cents more.
 */
function chargeCapFor(pageCount: number): number {
  const perPage = Number(process.env.BOOKMYSHOW_CHARGE_PER_PAGE_USD) || 0.02;
  return Math.min(Math.max(pageCount * perPage, 1), Number(process.env.BOOKMYSHOW_MAX_CHARGE_USD) || 10);
}

function toDateCode(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

# Theater Campaign Intelligence

Tracks how much of a film's slate BookMyShow still shows as having seats on sale, per
theater, so campaign spend can be pointed at the theaters where nobody is booking.

**This is not a ticket-sales tool.** Read §1 before using any number it produces.

Companion document: `BOOKMYSHOW-FEASIBILITY.md` records what BookMyShow actually exposes
and how that was established. This file is how to run the thing.

---

## 1. What the data is, and what it is not

BookMyShow publishes **no seat counts** on any page this feature is permitted to read.
There is no total, no available count, no sold count. Consequently:

- There is **no occupancy percentage**, and there cannot be one — there is no denominator.
- There is **no ticket-sales figure**, no revenue, and no seats-per-hour velocity.
- Anything phrased as "% full" would be fabricated.

What exists is a **4-level ordinal demand label per show**, which BookMyShow renders as a
coloured pill and carries in its page data as `availStatus`:

| `availStatus` | Shown as | Meaning | Confidence |
|---|---|---|---|
| 3 | Wide open | Plenty of seats still on sale | **Confirmed** |
| 2 | Filling | BookMyShow's own `fast_filling` label | **Confirmed** |
| 1 | Limited | More constrained than 2 | **Inferred** |
| 0 | Not on sale | Not being offered | **Inferred** |

Levels 1 and 0 are inferred, not confirmed. In particular **"Not on sale" is not "sold
out"** — it could equally be a cancellation, a blocked screen, a held allocation, or a show
past its booking cutoff. BookMyShow does not distinguish these, so neither do we, and
neither should anyone reading the output.

The useful signal is **movement**: a show going 3 → 2 → 1 as showtime approaches is demand
arriving. A show sitting at 3 twelve hours before screening is the thing worth acting on.

**Coverage.** Only theaters that sell through BookMyShow are visible. For the reference
campaign, ~178 venue-city rows were found against a real footprint of 285 Kerala theaters.
That gap is expected and accepted — the feature is scoped to BookMyShow-listed theaters.
But it means **aggregate figures describe the BookMyShow subset, not the Kerala market**,
and a theater absent from the table is not a theater with no audience.

## 2. Setup

### Environment variables

All server-side. `APIFY_TOKEN` is never exposed to the browser.

| Variable | Default | Purpose |
|---|---|---|
| `DATA_MODE_BOOKMYSHOW` | `mock` | `mock` \| `live`. Keep on `mock` until §6 passes. |
| `BOOKMYSHOW_MONITORING_ENABLED` | `false` | Allows the scheduled cron to run. Separate from the mode switch on purpose. |
| `APIFY_ACTOR_BOOKMYSHOW` | `apify/web-scraper` | Must be a JS-rendering actor (see §5). |
| `APIFY_TOKEN` | — | Existing project variable, reused. |
| `BOOKMYSHOW_SCAN_HORIZON_DAYS` | `3` | Days ahead each scan covers. |
| `BOOKMYSHOW_SCAN_CONCURRENCY` | `3` | Pages rendered in parallel. Kept low deliberately. |
| `BOOKMYSHOW_RUN_WAIT_MS` | `480000` | Wait budget per run. Must stay below the scan route's `maxDuration` (800s). |
| `BOOKMYSHOW_CHARGE_PER_PAGE_USD` | `0.02` | Used to size the per-run Apify spend cap. |
| `BOOKMYSHOW_MAX_CHARGE_USD` | `10` | Hard ceiling per run, enforced by Apify. |
| `RUN_BOOKMYSHOW_INTEGRATION_TEST` | `false` | Opt-in live test (§6). |

### Database migration

Additive only — it creates six new tables and touches nothing existing.

```
npm run db:migrate          # local (prisma migrate dev)
```

In deployment, `npm run build` already runs `prisma migrate deploy`.

New tables: `theater_campaigns`, `theaters`, `screenings`, `availability_snapshots`,
`bms_scan_runs`, `bms_scan_city_results`.

### Running with no Apify account at all

Mock mode is fully functional and is the default. It replays the real Kerala measurements
taken on 2026-08-20 across all 30 regions, so every screen works, the ranking is
exercisable against realistic data, and no traffic reaches BookMyShow. Scans served this
way are stamped `provider="mock"` and the UI shows a **Mock data** badge — a fixture-backed
number can never be mistaken for a live one.

## 3. Using it

1. **Theater Campaigns → New campaign.**
2. Enter the film's BookMyShow event code (e.g. `et00502829`) or paste an
   `in.bookmyshow.com` movie URL. Nothing else is accepted — this is an allowlist, not a
   convenience (§7).
3. Leave all cities unticked to scan **every Kerala region** BookMyShow lists, or tick
   specific ones.
4. Set the scan interval and thresholds:
   - **Flag a theater at (% shows wide open)** — default 80.
   - **Minimum shows before judging** — default 3. Small venues run few shows; one quiet
     slot is not a signal.
5. **Run scan now**, or wait for the cron.

The campaign page ranks theaters worst-first, with the reasons for each score written out.
Click a theater for its individual shows, their demand history, and a source-data panel
showing the raw `availStatus` behind every reading.

### Reading the scan status panel

It is there to make failure loud. A scan that could not read some cities lists them
explicitly as **not scanned** — never as cities with no demand. If `Rows skipped` jumps,
BookMyShow has probably changed something; check `demand.ts` and `normalize.ts`.

## 4. Scheduled scans

Registered in `vercel.json` at `*/30 * * * *`, hitting
`/api/cron/scan-theater-campaigns`. Requires `CRON_SECRET` (existing pattern) and
`BOOKMYSHOW_MONITORING_ENABLED=true`.

The cron ticks every 30 minutes but scans each campaign only once its own
`scanIntervalMinutes` has elapsed. A `cronLock` prevents overlapping ticks, and a
per-campaign lock prevents a manual scan racing a scheduled one.

**Volume.** 30 Kerala regions × 3 dates ≈ 90 page renders per scan. At 90-minute intervals
that is roughly 1,400 renders/day. Treat the interval as the politeness lever.

## 5. Why a browser actor is required

A plain HTTP GET of a BookMyShow showtime page returns an empty React shell — the JSON-LD
is generic boilerplate and there are no showtimes in the HTML. The data only exists after
client-side hydration, so the collector must execute JavaScript and read
`window.__INITIAL_STATE__` from the rendered page.

**Two things that will break it if changed:**

1. **Region is resolved from an `rgn` cookie, not the URL.** Three different city URLs
   returned Kochi data during investigation, and the URL silently rewrote itself. The
   collector sets `rgn` per request via `preNavigationHooks` and then **asserts** the
   region code the payload echoes back. A mismatch is recorded as a failed city.
2. **Do not "optimize" this into a direct API call.** `/getJSData/` and `/getHTML*` are
   robots-disallowed. Rendering the permitted public page is the line the entire
   compliance position rests on.

## 6. Verifying the actor actually satisfies the requirement

**This has never been run successfully.** Both `apify/web-scraper` and
`apify/puppeteer-scraper` return `403 full-permission-actor-not-approved` until the actor's
permissions are approved once in the Apify console.

Once approved:

```
RUN_BOOKMYSHOW_INTEGRATION_TEST=true npx vitest run src/lib/bookmyshow/integration.live.test.ts
```

One city, one date, one page render. It asserts, in order:

1. The page **hydrated at all** — a failure here is the open datacenter-IP question, not a
   flaky test. Every observation behind this feature was made from a residential browser;
   it is unknown whether BookMyShow serves these pages to cloud infrastructure. If this
   fails, the remedies would be proxies and stealth fingerprinting, which are out of scope
   — the correct response is to stop and pursue an authorized feed.
2. The returned region matches the requested one (the cookie mechanism works).
3. Theaters and shows were extracted, with stable `sessionId`s.
4. Shows carry `availStatus`, and only values in the documented `0–3` vocabulary.

It logs the observed status distribution, so a run doubles as a check that the documented
meanings still hold.

**Then:** log a sample of shows every 30 minutes for ~48 hours and read the deltas, to
confirm (a) `availStatus` actually moves, and (b) whether shows transition 2 → 1 and never
1 → 2, which is what would settle level 1's position on the scale.

## 7. Security

- All campaign pages and endpoints sit behind the existing NextAuth session. Server Actions
  call `requireSession()` — page-level gating is not a boundary, since actions are POST-
  reachable independently.
- **URL allowlist.** A campaign stores an event code, and every scanned URL is *built* from
  that code plus a region from the registry. A user-supplied URL is never fetched verbatim,
  and only `in.bookmyshow.com` is accepted (exact host match, so look-alike domains fail).
  This is what stops the feature being a generic arbitrary-URL scraper or an SSRF vector.
- `APIFY_TOKEN` is server-only. The scan-status endpoint returns an explicitly shaped
  object so `apifyRunId` / `datasetId` — which identify billable resources — never reach a
  browser.
- Errors returned to the client are messages only; actor inputs and error objects are not
  serialized outward. Logs carry counts and ids, never tokens, cookies, or headers.
- Scan intervals come from an allowlist with a 30-minute floor. A per-campaign lock plus
  the cron lock bound how often anything can be triggered.

## 8. Data retention

`availability_snapshots` is append-only and is the entire value of the feature — one
reading is not a trend. It holds no personal data: theater names, show times, and an
ordinal status. It is therefore **not** covered by the `prune-raw-payloads` cron, which
exists for third-party personal data (see `DATA-PRIVACY.md`).

No raw BookMyShow payload is stored. The page function extracts a compact summary in the
browser and only normalized fields are persisted, alongside the raw `availStatus`,
`styleId` and source label needed to audit a reading.

If snapshot volume becomes a problem, the right move is downsampling old rows (keep first
and last per show per day), not deletion — losing early snapshots destroys the movement
calculation retroactively.

## 9. Compliance assumptions

Established 2026-08-20; recheck before scaling up.

- `/movies/.../buytickets/...` is **not** disallowed for `User-agent: *` in
  `robots.txt`, and BookMyShow publishes these exact URLs in its own
  `sitemap/movie-shows.xml` with `changefreq: daily`.
- No login, credentials, cookies belonging to a user, booking, seat-lock, or payment action.
- No CAPTCHA, anti-bot, rate-limit, or access-control circumvention. No proxy rotation.
- The `rgn` cookie we set is a first-party city preference, equivalent to picking a city in
  the UI.
- **Residual risk:** BookMyShow's terms prohibit unauthorized scraping in general terms,
  and robots.txt permission is not contractual permission. Volume is the main lever;
  an authorized distributor or exhibitor feed remains the better long-term source. This is
  a business decision the code cannot settle.

## 10. Tests

```
npm run test:unit        # 214 tests; the live integration test skips unless opted in
npx tsc --noEmit         # npm run lint is broken project-wide, pre-existing
npx next build
```

Covered: normalization, missing/changed fields, unknown `availStatus` values, IST and
past-midnight show handling, region mismatch, page errors, demand mapping and confidence,
movement, priority scoring and its sample-size gate, the URL allowlist, and campaign
validation. Two guard tests assert no user-facing string uses sales or occupancy wording.

Apify is never called in the default suite.

## 11. Known gaps

- The live path has never executed (§6). Until it does, `DATA_MODE_BOOKMYSHOW` stays `mock`.
- `availStatus` 0 and 1 semantics are inferred.
- The Kerala region list is seeded from a sitemap, which carries no completeness guarantee.
  Enumerating regions from BookMyShow directly would be more robust.
- Scans are synchronous. If a Kerala-wide scan outgrows the wait budget, the migration path
  is the async handoff `ScoutRun` already models — `BmsScanRun` carries `apifyRunId` and
  `datasetId` columns for exactly that.
- Alerts are not wired up. The thresholds are stored and drive the on-screen ranking, but
  nothing sends anything yet; `NotifierProvider` is the seam when it is wanted.

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
| `BOOKMYSHOW_MOCK_FAIL_CITY` | unset | Mock mode only. Set to a region code (e.g. `GOOL`) to simulate a city that always fails, exercising the partial-scan UI. |
| `DATA_MODE_NOTIFIER` | `mock` | Existing project variable. `mock` = alerts log to console (dry run); `live` = email via Resend. |
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
explicitly as **not scanned** — never as cities with no demand.

Two counters matter:

- **Rows skipped** — rows that could not be read at all (missing show id, unparseable
  time). A jump means BookMyShow changed a field shape.
- **Unrecognised availability codes** — rendered as a red alert, and the more serious of
  the two. It means BookMyShow returned an `availStatus` outside the documented `0–3`
  vocabulary. Because unrecognised readings are excluded from demand signals, the symptom
  of ignoring this is a priority table that *quietly empties* rather than an error. Any
  non-zero value means stop and re-read `demand.ts` before acting on the ranking.

## 3a. Alerts

After each scheduled scan that read something, theaters in the **push here** band raise an
`Alert` row and are sent through the existing `NotifierProvider`. No new notification
machinery — the same seam the fan-page alerts use.

- `DATA_MODE_NOTIFIER=mock` (default) logs to console. That is the dry-run mode.
- `DATA_MODE_NOTIFIER=live` sends email via Resend, using the existing
  `RESEND_API_KEY` / `ALERT_EMAIL_FROM` / `ALERT_EMAIL_TO`.

Deduped per theater per campaign scan-interval window, so a 90-minute campaign cannot email
the same "Palakkad is quiet" line sixteen times a day. Alerts are **never** raised off a
failed scan, and every alert body carries the line stating it is based on availability
labels rather than ticket sales.

Alerts fire from the cron only, not from a manual "Scan now" — clicking scan to look at
data should not mail anyone. Delivery failures are logged, not thrown: a mail outage must
not fail a scan whose data landed correctly.

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

## 5a. Local capture — the working collection path

`scripts/bms-capture.mjs` drives the **real Chrome installed on the operator's machine**,
over that machine's own connection, and POSTs its findings to
`/api/theater-campaigns/{id}/ingest`. That endpoint runs the same `ingestScrapeItems()`
pipeline a provider-driven scan would, so both routes share one definition of the truth.

```
node scripts/bms-capture.mjs --campaign <campaignId>
node scripts/bms-capture.mjs --campaign <id> --cities KOCH,PLKK --days 1 --dry-run
```

Schedule it once and it is unattended:

```
.\scripts\install-bms-capture-task.ps1 -CampaignId <id> -Times '09:00','14:00','19:00'
```

The task runs interactively because Chrome needs a desktop session — the machine has to be
on and logged in, and you will see the window appear.

### Measured success rate: asking for less gets you more

The hit rate is **not** a fixed probability per page. It collapses as a run gets longer.
Every measurement taken on 2026-08-20:

| Pages requested in one run | Succeeded | Rate |
|---|---|---|
| 2 | 1 | 50% |
| 4 | 2 | 50% |
| 6 | 3 | 50% |
| 6 | 2 | 33% |
| **30** | **1** | **3%** |
| **30** | **1** | **3%** |

The first pages of a run go through and then it clamps — the shape of a small burst
allowance, not of a coin flip. A 30-page sweep spends 29 requests to learn nothing.

**So a short run is both politer and more productive**, which is a rare thing to be able to
say. `--max-cities` caps the pages per run; the registered task uses `6`, which returns two
or three cities where asking for all thirty returned one. That is the whole argument for it.

> This is the point to be careful about. Requesting fewer pages is not a trick for getting
> more out of a session — the per-run yield is what BookMyShow allows either way, and the
> gain comes entirely from **not sending requests that were going to be refused**. If a
> change here starts trying to widen what a single session yields — cycling browser
> sessions, spacing runs to dodge the clamp — that is the line, and `capture.test.ts`
> exists to catch it.

**Which cities go in the window matters as much as how many.** The list arrives in a fixed
order, so a sweep would otherwise read Kochi three times a day and never see the rest of
Kerala. `resolveCities` rotates the window by **one** city per run.

One, not the window size: with 30 regions and a window of 6, `bucket * 6 % 30` takes only 5
distinct values, so just 5 cities would ever reach the front. Stepping by 1 also degrades
gracefully — a larger step tuned to "about 3 succeed" would starve every city whose index
did not line up, on a day when only one got through.

**Coverage accumulates; it is never complete in one run.** Each city-date is independent, a
403 is recorded as a *failed city* and never as a city with no demand, and snapshots are
idempotent per scan run. At three runs a day the window's leading edge advances about three
positions daily, so expect a full pass over Kerala in **roughly a week to ten days**, with
recently-read districts refreshed more often than distant ones. A theater's "last seen" can
therefore be days older than the last scan — which is why the UI shows per-theater
last-seen times, and why aggregate figures must be read as a rolling picture rather than a
snapshot of one moment.

### Do not try to raise the hit rate

The script contains no stealth plugin, no fingerprint patching, no user-agent override and
no proxy, and `src/lib/bookmyshow/capture.test.ts` asserts all of that. It works because it
genuinely is an ordinary browser, not because it is disguised as one — that distinction is
the entire basis for collecting this way.

If the 403 rate climbs toward 100%, the correct response is to **stop and pursue authorized
access**, not to start pretending. A retry-until-through loop is how a defensible tool
becomes an attack; the script deliberately exits when every page fails rather than looping.

## 6. Server-side collection is BLOCKED — read this before enabling anything

**Tested 2026-08-20 with the actor permission approved. BookMyShow blocked it.**

`apify/web-scraper` against one Kochi showtime URL returned
`Request blocked - received 403 status code` on all four attempts. Same URL, same few
minutes: a real Chrome browser loaded it fine, while `curl` on that *same connection* was
also refused — so this is **request-fingerprint anti-bot protection, not an IP block**, and
moving the collector off a datacenter would not fix it.

Getting through would need stealth fingerprinting or residential proxy rotation. Both are
out of scope (§9), so **`DATA_MODE_BOOKMYSHOW` must stay `mock`** and
`BOOKMYSHOW_MONITORING_ENABLED` must stay `false`.

The Apify provider code remains in the tree because it is correct as written and costs
nothing to keep — if authorized access is ever granted, it is the shape that access would
plug into. It is not dead code to delete; it is a wired-up path with a closed door in
front of it. Everything above the fetch — schema, normalization, scoring, UI — is
unaffected and works today against the mock provider.

See `BOOKMYSHOW-FEASIBILITY.md` §9 for the routes that remain open (authorized feed,
periodic manual capture).

### Re-testing later, if something changes

The test below is kept for exactly that. It is still opt-in and still safe to run.

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
npm run test:unit        # 236 tests; both opt-in tests skip unless enabled
npx tsc --noEmit         # npm run lint is broken project-wide, pre-existing
npx next build
```

Covered: normalization, missing/changed fields, unknown `availStatus` values, IST and
past-midnight show handling, region mismatch, page errors, demand mapping and confidence,
movement, priority scoring and its sample-size gate, the URL allowlist, campaign
validation, that no secret reaches an API response or a client component, and that every
exported Server Action calls `requireSession()`. Guard tests assert no user-facing string
uses sales or occupancy wording.

Apify is never called in the default suite.

### The opt-in database test

```
RUN_BMS_DB_TEST=true npx vitest run src/lib/data/theaterCampaignIngest.live.test.ts
```

Writes to whatever `DATABASE_URL` points at, using the mock provider — no BookMyShow
traffic, no Apify spend — and deletes the campaign it creates.

It runs the same scan **twice**, and that is the point. The two worst bugs this pipeline
has had were both invisible to a single run:

- Per-row writes inside one transaction took the *first* city past Prisma's 5s
  interactive-transaction limit. The transaction rolled back, the throw escaped the scan
  loop, and a 30-city scan wrote nothing while its run row sat in `running` forever.
- If `lastSeenAt` ever stops being refreshed, scan #1 still looks perfect and scan #2 marks
  the entire slate as disappeared — which reads downstream as every theater in Kerala
  pulling the film.

**Ingest must stay bulk.** The number of statements per city has to be fixed, not
proportional to the number of shows on the page. A Kerala city page carries ~180 shows;
written one row at a time that is ~390 sequential round trips to a pooled connection, which
does not fit in a transaction. If a city ever needs more than the 20s backstop in
`ingestCityResult`, the shape of the writes is wrong again — do not raise the timeout.

**Mock data must never be left in a real campaign.** Mock venue codes are synthetic, so
they never merge with real BookMyShow venues, and the detail page reads snapshots across
all runs — so a campaign holding both would rank on a blend of fabricated and real
readings while badging itself live. Scan a throwaway campaign, or delete the mock runs
afterwards.

## 11. Known gaps

- **Server-side collection is blocked (§6).** `DATA_MODE_BOOKMYSHOW` stays `mock`. The
  working path is local capture (§5a), which needs an operator machine that is on and
  logged in, and which loses roughly half its pages to 403s on any given run.
- **Capture coverage is probabilistic.** Any single run returns partial data. Coverage is
  accumulated across runs rather than guaranteed per run, so a theater's "last seen" can be
  hours older than the last scan. The UI shows per-theater last-seen times for that reason.
- `availStatus` 0 and 1 semantics are inferred, and — because the 48-hour delta run needed
  automated collection — they can no longer be settled cheaply.
- The Kerala region list is seeded from a sitemap, which carries no completeness guarantee.
  Enumerating regions from BookMyShow directly would be more robust.
- Scans are synchronous. If a Kerala-wide scan outgrows the wait budget, the migration path
  is the async handoff `ScoutRun` already models — `BmsScanRun` carries `apifyRunId` and
  `datasetId` columns for exactly that.
- Theater `cityCode` records where a venue was FIRST seen. BookMyShow lists the same venue
  under several adjacent regions, so filtering by city is approximate at the boundaries
  (an Angamaly venue may file under Kochi). Deduplication by `venueCode` is exact; region
  attribution is not.

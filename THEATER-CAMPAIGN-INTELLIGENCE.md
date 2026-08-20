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
| `BOOKMYSHOW_ALERT_DEDUP_MINUTES` | `720` | Floor on how often one theater can alert (§3a). Must outlast the gap between captures. |
| `BOOKMYSHOW_CAPTURE_MAX_PER_DAY` | `6` | Server-side cap on capture ingests per campaign per 24h. |
| `BOOKMYSHOW_CAPTURE_SECRET` | — | Shared secret for the capture ingest endpoint (§5a). No default: unset means the endpoint is closed. |
| `RUN_BOOKMYSHOW_INTEGRATION_TEST` | `false` | Opt-in live test (§6). |
| `RUN_BMS_DB_TEST` | `false` | Opt-in database test (§10). |

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
5. Collect data with the **local capture** (§5a). "Run scan now" is not that — see below.

The campaign page ranks theaters worst-first, with the reasons for each score written out.
Click a theater for its individual shows, their demand history, and a source-data panel
showing the raw `availStatus` behind every reading.

### What "Run scan now" actually does — and why it refuses

It runs a **server-side** scan through whatever `DATA_MODE_BOOKMYSHOW` selects. That is
`mock` in every deployment, because BookMyShow blocks server-side collection (§6). It cannot
drive the Chrome on your machine, so it can never fetch live showtimes.

So on a campaign built from real captures, the button would inject **fabricated** theaters
and readings — mock venue codes look like `KOCH01`, where a real one is `ZTKC` — into the
exact table used to decide where campaign money goes. Synthetic codes never merge with real
venues, so they persist as phantoms, and the detail page reads snapshots across *all* runs,
so the ranking would blend invented numbers with measured ones.

**It now refuses**, with a 409 and an explanation, whenever the campaign already holds real
captured data. The cron applies the same rule, which matters more there: nobody is watching
an unattended tick dilute real data.

Mock scanning stays fully available on a campaign with **no** real data — that is what makes
the feature demoable without an Apify account. The rule is about *mixing fixtures into
measurements*, not about mock being bad.

To actually collect data, use the local capture (§5a).

### Reading the scan status panel

It is there to make failure loud. A scan that could not read some cities lists them
explicitly as **not scanned** — never as cities with no demand.

**The date column is the date REQUESTED, not necessarily the date returned.** Late in the
day BookMyShow stops listing today's remaining shows — they are past their booking cutoff —
and serves the next available date instead. Observed 2026-08-20 at 17:26 IST: a request for
`20260820` came back with fourteen shows all running 09:00–23:59 on the **21st**, and a
second request for `20260821` returned the same fourteen.

Nothing is corrupted by this, and it is worth being precise about why: every screening
carries its own `showDate`, derived from the show's own start time in IST, and that value
was verified correct against the raw instants. The ranking is computed from screenings, so
the ranking is right. Only the scan-result row's date can mislead — reading it as proof that
a particular date was read is the mistake to avoid. **Trust the screening's date, not the
request's.**

Two practical consequences:

- An evening run asking for two dates spends both on the same slate. The morning and
  midday runs are the ones that get today *and* tomorrow. This is one reason the daily
  triggers are spread rather than clustered.
- A repeat is not wasted data: the snapshot unique constraint means the second read updates
  nothing and adds no duplicate history.

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

Alerts are **never** raised off a failed scan, and every alert body carries the line stating
it is based on availability labels rather than ticket sales.

Alerts fire from the cron and from a **capture ingest** — not from a manual "Scan now", since
clicking scan to look at data should not mail anyone. Delivery failures are logged, not
thrown: a mail outage must not fail a scan whose data landed correctly.

### One alert per theater per 12 hours

Deduped per theater, over `max(campaign.scanIntervalMinutes, BOOKMYSHOW_ALERT_DEDUP_MINUTES)`
— default **720 minutes**. The campaign's own interval is a **floor**, not the whole rule.

It used to be the interval alone, which was right while the Vercel cron was the only caller:
scans and alerts shared a cadence, so "once per scan interval" meant "once per scan". The
local capture path broke that. Captures run three times a day, five hours apart, against a
90-minute campaign interval — so every run fell outside the window and re-alerted every
flagged theater. Measured 2026-08-20: **32 flagged theaters × 3 runs ≈ 96 notifications a
day**, heading for ~530 at full Kerala coverage. Exactly what the dedup existed to prevent.

Set `BOOKMYSHOW_ALERT_DEDUP_MINUTES` higher for a quieter inbox, or lower to be told sooner.
Note it is a floor: a campaign that already asks for less frequent alerts keeps its own
interval.

> **Still one email per theater.** At full coverage that is up to ~178 separate messages in a
> day even at one per theater. If that proves too noisy in practice, the fix is a **digest** —
> one message listing the flagged theaters — rather than a longer window, since a longer
> window delays the signal this feature exists to deliver. That is a product decision and has
> not been made.

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

Either way it runs on a **machine**, not on Vercel: Chrome needs a desktop session, so the
laptop has to be on and logged in, and the window is visible while it works.

#### On demand (how this is actually run)

A double-clickable launcher, because a laptop that may be closed at 19:00 cannot be the
thing a schedule depends on. Nothing fires on a timer.

```bat
cd /d C:\Projects\StarAnalytics
node "scripts\bms-capture.mjs" --campaign <id> --url https://staranalytics.vercel.app --sweep --days 1
pause
```

Saved as a `.cmd` on the Desktop. `pause` matters — without it the window closes before the
result can be read, and partial results are the normal case here, not an error to hide.

`--sweep` reads **every** Kerala region rather than one burst's worth, by pausing between
small batches. It takes about **40 minutes**, so click it and come back — the window shows
which batch it is on throughout. See the measurements below for why this works and why it
is not a way around anything.

Drop `--sweep` for a quick partial look instead: one burst, about four cities, under a
minute.

#### Scheduled (available, not in use)

```
.\scripts\install-bms-capture-task.ps1 -CampaignId <id> -Times '09:00','14:00','19:00'
```

Registers a Windows task. Remove it again with:

```
Unregister-ScheduledTask -TaskName 'StarAnalytics BMS Capture' -Confirm:$false
```

Worth knowing if you ever schedule it: **`--max-cities` counts cities, not pages.** A run
requests `cities × dates` and `--days` defaults to 2, so `--max-cities 6` is twelve pages
and clamps as badly as a full sweep.

#### The daily cap is checked before the browser opens

`BOOKMYSHOW_CAPTURE_MAX_PER_DAY` (default 6, rolling 24 hours) is enforced by the ingest
route — that is the only thing that decides. But the capture plan also reports
`capturesRemaining`, and the script stops on zero **before** launching Chrome.

Without that, hitting the cap meant fetching every page from BookMyShow and then having the
whole run rejected with a 429: requests spent, nothing learned. Two failures that look alike
in the log need opposite responses, and the launcher spells both out —

- **"Daily capture limit already reached"** — our own cap. Nothing was requested from
  BookMyShow. Come back later.
- **HTTP 403 / every page failed** — BookMyShow refused us. Do **not** click again;
  repeated retries are what turn a defensible tool into abuse.

### Measured behaviour: a burst allowance that a pause restores

BookMyShow serves roughly **four to six pages**, then starts refusing with 403. **A pause of
about five minutes restores it completely, in the same browser session.**

That second sentence is the important one, and it was missed for most of a day. Measured
2026-08-20:

| What was run | Result |
|---|---|
| 8 pages back to back | 4 ok, then 4 × 403 — refusals begin mid-run |
| 6 pages, **5 min pause**, 6 more | **12 / 12 ok** — same session, same cookie jar |
| 30 pages back to back | 1 ok, 29 × 403 |

Earlier notes in this file read the first and third rows as "the hit rate collapses as a run
gets longer" and concluded that a run yields about one city. That was wrong. Nothing
collapses: an allowance is spent and then refills. A fast run of 30 pages and a paced run of
30 pages differ by everything.

#### There is a second, slower limit — and a day of testing found it

The five-minute recovery above is not unconditional. Later the same day, after roughly
**150 page requests** across an afternoon of investigation, a paced sweep was refused
outright: three batches, five-minute pauses between them, **1 of 12 pages served**. The same
pacing that had returned 12/12 a couple of hours earlier returned nothing.

So there are two limits stacked: a short burst allowance that a five-minute pause restores,
and a **slower, day-scale budget that pauses do not restore**. Exhaust the second and the
first stops helping.

The practical rule: **one sweep a day, and do not investigate on the same day you need
data.** A sweep started from a quiet day should complete; a sweep started after heavy use
will stop early, by design, having learned nothing new.

The correct response when this happens is the one the script takes automatically — stop.
Not shorter batches, not longer pauses, not "just one more try". Come back tomorrow.

### Reading everything: `--sweep`

```
node scripts/bms-capture.mjs --campaign <id> --sweep --days 1
```

Reads **every** Kerala region by working in batches of `--batch-size` (default 4, just under
the observed allowance) with `--batch-pause-ms` between them (default 5 minutes, just over
the observed recovery). Thirty regions takes roughly **40 minutes**.

Refused pages get **one** deferred retry at the end, because a 403 here means "not right
now" and the pauses demonstrate that recovers. One pass, never a loop.

If two consecutive batches return nothing at all, the sweep stops. At that point it is no
longer a throttle to wait out, and continuing to ask would just be asking.

> **The line is identity, not patience.** An earlier version of this document called
> "spacing runs to dodge the clamp" evasion. That was drawn in the wrong place — it would
> make every well-behaved backoff illegitimate, when waiting is precisely the response a 403
> is asking for.
>
> What must never happen is changing **who we appear to be** in order to be served more than
> one client would be: proxies, user-agent or fingerprint spoofing, or cycling browser
> sessions and profiles to reset a per-session limit. The sweep does none of these — one
> `chromium.launch`, one `newContext`, one cookie jar for the whole run, and
> `capture.test.ts` asserts each of those counts is exactly one.
>
> Going slower to stay inside what a site will serve is not a workaround. Going faster while
> pretending to be someone else is.

### Rotation, for single-burst runs

Without `--sweep`, a run spends one burst. Since the city list arrives in a fixed order it
would otherwise read the same first cities every time, so `resolveCities` rotates the window
by **one** city per run — not by the window size, since with 30 regions and a window of 6
`bucket * 6 % 30` takes only 5 distinct values and just 5 cities would ever reach the front.

**Count pages, not cities.** `--max-cities` caps cities, but a run requests `cities × dates`
and `--days` defaults to **2**, so `--max-cities 6` is twelve pages.

### Coverage is a rolling picture

Each city-date is independent, a 403 is recorded as a *failed city* and never as a city with
no demand, and snapshots are idempotent per scan run. A theater's "last seen" can be older
than the last scan, which is why the UI shows per-theater last-seen times and why aggregate
figures should be read as accumulated rather than as one instant.

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

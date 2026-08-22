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

Live BookMyShow no longer sends `availStatus`; the same states are read from the rendered
pill instead (green = wide open, orange + `fast_filling` = filling, orange alone = limited).
A fourth appeared on 2026-08-21 and was caught by the unmapped alarm rather than slipping
through: **grey = not on sale**, read as `unavailable`.

The obvious explanation for grey — past its booking cutoff — was **tested and rejected**.
All six grey shows were in the future at capture time (18:45–22:50 IST, captured 16:59) and
a green, bookable show sat at 18:00, earlier than several of them. What remains is sold out,
not yet on sale, or a held screen — opposite in meaning, and BookMyShow does not say which.
That is precisely what `unavailable` is for: it carries no rank and is excluded from demand
signals, so a grey show can neither inflate nor deflate a theater score.

Levels 1 and 0 are inferred, not confirmed. In particular **"Not on sale" is not "sold
out"** — it could equally be a cancellation, a blocked screen, a held allocation, or a show
past its booking cutoff. BookMyShow does not distinguish these, so neither do we, and
neither should anyone reading the output.

The useful signal is **movement**: a show going 3 → 2 → 1 as showtime approaches is demand
arriving. A show sitting at 3 twelve hours before screening is the thing worth acting on.

**Coverage, against a real denominator.** The campaign owner supplied the actual footprint
on 2026-08-21: **285 theatres** playing the film across Kerala, kept at
`reference/bethlehem-kudumba-unit-theatres.txt`. Coverage should be stated against that,
not against however many rows happen to be captured — a row count says nothing about what
is missing.

Only theatres that sell through BookMyShow are visible, and not all 285 do. So the feature
can never reach 285, and **aggregate figures describe the BookMyShow subset, not the Kerala
market**. A theatre absent from the table is not a theatre with no audience.

Beware naive matching: the distributor’s town names are not BookMyShow’s region names.
TRIVANDRUM is THIRUVANANTHAPURAM, ERNAKULAM is KOCH, KANJAHGAD is KANHANGAD. A token match
that ignores this undercounts badly.

One district per run, three days deep. **Three pages** — comfortably under the handful
BookMyShow serves before it starts refusing, so a run completes instead of being cut off
partway.

```bat
cd /d C:ProjectsStarAnalytics
node "scriptsms-capture.mjs" --campaign <id> --url https://staranalytics.vercel.app --max-cities 1 --days 3
pause
```

Saved as a `.cmd` on the Desktop. `pause` matters — without it the window closes before the
result can be read, and partial results are the normal case here.

**The server chooses the district, not the script.** `capture-plan` returns them ordered by
how long since each was last read SUCCESSFULLY, oldest first, so each run continues where
the last stopped without anything being remembered locally. A district whose last read was
refused does not count as read, so it comes back around quickly rather than waiting a full
cycle — which matters when BookMyShow refuses a few pages of most runs.

Three days rather than one is the point of the shape: the whole purpose is seeing weak
demand **before** the screening, and one day gives almost no lead time. It also sidesteps
the evening rollover (§3), where today’s slate is already past its booking cutoff.

At six runs a day that is roughly a full pass over Kerala every five days, with three days
of forward visibility per district. Run it more often for a faster cycle — the cap is the
ceiling, not a target.

> Why not one big sweep? `--sweep` reads everything in paced batches (~40 min), but a long
> run also spends the slower day-scale budget (below) and tends to stop early once that is
> exhausted. Several small runs get further, and each one lands its data immediately rather
> than risking the whole run.

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

`BOOKMYSHOW_CAPTURE_MAX_PAGES_PER_DAY` (default 120, rolling 24 hours) is enforced by the
ingest route — that is the only thing that decides. The capture plan also reports
`pagesRemaining`, and the script stops on zero **before** launching Chrome.

**It counts pages, not runs**, and that distinction matters. It used to cap runs at 6, sized
when a run meant thirty to ninety pages. A district run is now three, so the old cap allowed
eighteen pages a day — about a tenth of what it was written to permit — and it became the
binding constraint rather than the backstop it was meant to be. Measured on 2026-08-21: the
run cap left 3 runs, the page cap left 57 pages, roughly 19 district runs.

Volume is what the human-scale justification is about, so volume is what is counted. A
sweep is charged for what it actually costs — two 30-page sweeps that read three districts
between them spent 60 pages, and the ledger now says so.

Without the pre-flight check, hitting the cap meant fetching every page from BookMyShow and
then having the whole run rejected with a 429: requests spent, nothing learned. Two failures
that look alike in the log need opposite responses, and the launcher spells both out —

- **"Daily page limit already reached"** — our own cap. Nothing was requested from
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

#### What limits a run is BURST SIZE, not the day's total

An earlier version of this section claimed a "slower, day-scale budget that pauses do not
restore", and advised one sweep a day. **That was wrong, and the correction matters** — it
was the reasoning behind a cap that then throttled real collection for a day.

The evidence for it was a sweep that collapsed after an afternoon of heavy use. The
confound: that afternoon was mostly *30-page bursts*. Volume and burst size moved together,
and burst size was blamed on the wrong variable.

Measured properly on 2026-08-22 — **thirty consecutive 3-page runs, 240 cumulative pages in
one day**:

| | hit rate |
|---|---|
| 3-page runs, first half (15 runs) | **76%** |
| 3-page runs, second half (15 runs) | **71%** |
| 30-page runs, same period | **3–7%** |

Five percentage points of drift across 240 pages. There is no day-scale wall for runs of
this shape. What collapses a run is asking for thirty pages at once; a 3-page run keeps
being served all day.

So the rule is the opposite of what was written here: **many small runs, freely.** The thing
to avoid is the big burst, not the busy day.

The `--sweep` mode below is kept because it works from a quiet start, but district-at-a-time
is both cheaper and more reliable, and it is what the launcher uses.

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
by **one** city per run — not by the window size. Stepping by the window only ever reaches
`N / gcd(N, window)` starting points: with the 30 regions configured when this was written,
`bucket * 6 % 30` took just 5 distinct values, so only 5 cities ever reached the front. At
today's 32 it is 16 of 32 — better, but still half the list frozen out, and it swings on the
region count rather than on anything deliberate. Stepping by one reaches all N whatever N is.

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
- **The region list is incomplete, and this is now the largest known gap.** Measured
  2026-08-21 after a full pass in which all 30 regions then configured were read
  successfully: four areas of the campaign's own theatre list returned **no venue at all**.
  Two region codes have since been read and added (2026-08-22), so the list now stands at
  32 and the table below is part-closed.

  | Area | Towns with no venue found | On the campaign list | Region since added |
  |---|---|---|---|
  | Wayanad | Kalpetta, Sulthan Bathery, Mananthavady, Pullpally | ~6 theatres | — still missing |
  | Idukki hills | Kattappana, Adimali, Nedumkandam, Rajakumari | ~5 | — still missing |
  | North Kannur | Payyannur, Iritty, Mattannur, Koothuparamb, Peravoor… | ~12 | `KASA` (Kasaragod), north of the belt |
  | Malappuram belt | Malappuram, Tirur, Ponnani, Nilambur, Kottackal… | ~20 | `MALP` (Malappuram) |

  These are **not** "not on BookMyShow" — they are towns whose region is never requested.
  The regions we do have reach further than their names suggest (Chittur, Shoranur,
  Cherthala, Haripad, Ettumanoor, Karunagapally, Thamarassery and Edappal all surfaced
  inside a neighbour's catchment), which is why adding one region can close several towns.

  **What the two additions actually settle is not yet measured.** `MALP` and `KASA` mean
  those regions are now *requested*; whether their catchments reach Tirur, Ponnani,
  Nilambur, Kottackal, Payyannur or Iritty is exactly the kind of thing this list has been
  wrong about before, and the honest answer is that the next full pass will say. Wayanad and
  the Idukki hills are untouched by both — no configured region sits in either.

  **Getting the missing region codes needs a human step, on purpose.** A URL needs both the
  region CODE and its slug (`kalpetta:kalpetta`), and the code cannot be derived from the
  town name. Five avenues were tried on 2026-08-21 and none is available: the hydration state
  carries only the current region; four plausible region endpoints all return 403; the city
  chooser and its search box render nothing extractable; and `robots.txt` publishes no
  `Sitemap:` line, so there is no crawlable index — which also means the sitemap this list
  was originally seeded from is gone.

  What is left is guessing slugs and probing for the ones that resolve. **Do not do that.**
  Twenty-odd speculative requests hunting for endpoints that answer is the behaviour §5a
  exists to rule out, and it would spend the daily page budget on 404s.

  The cheap, legitimate path is to open BookMyShow's own city picker, pick the missing
  towns, and read the region off the resulting URL. Two minutes of a person using the site
  normally, and the codes can then be added to `KERALA_REGIONS` in
  `src/lib/bookmyshow/urls.ts` and the mirrored `REGIONS` map in `scripts/bms-capture.mjs`.
- Scans are synchronous. If a Kerala-wide scan outgrows the wait budget, the migration path
  is the async handoff `ScoutRun` already models — `BmsScanRun` carries `apifyRunId` and
  `datasetId` columns for exactly that.
- Theater `cityCode` records where a venue was FIRST seen. BookMyShow lists the same venue
  under several adjacent regions, so filtering by city is approximate at the boundaries
  (an Angamaly venue may file under Kochi). Deduplication by `venueCode` is exact; region
  attribution is not.

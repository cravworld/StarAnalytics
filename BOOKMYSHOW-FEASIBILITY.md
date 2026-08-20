# BookMyShow data feasibility — Theater Campaign Intelligence

Spike run **2026-08-20** against the live campaign title **Bethlehem Kudumba Unit**
(`et00502829`). Question: can StarAnalytics tell, before a screening, which theaters a
film is underperforming at, using only authorized, publicly permitted BookMyShow data?

**Answer: yes, at ordinal-demand resolution.** Not exact ticket sales, and not seat
counts. Read §3 and §7 before designing anything on top of this.

---

## 1. Apify's BookMyShow actors cannot drive this feature

Both public actors were checked against their published documentation, not their
marketing copy.

| Actor | Movie metadata | Venues | Showtimes | Seat/availability |
|---|---|---|---|---|
| `thirdwatch/bookmyshow-scraper` | yes | events only | **no** | **no** |
| `getascraper/bookmyshow-scraper` | yes | events only | **no** | **no** |

`thirdwatch`: *"Showtime and seat-selection data requires a logged-in session and is
intentionally not scraped."* `getascraper`: *"reads only public BookMyShow pages — no
login, booking flow, seat map, or seat-availability data."*

Reseller pages advertising "theater seating availability" for these actors contradict
the actor READMEs and should be disregarded. The actors remain useful only for movie
metadata (title, event code, languages, certification, runtime, cast).

## 2. BookMyShow's own public showtime pages do provide the signal

### Discovery is officially published

`robots.txt` lists `sitemap/movie-shows.xml`, which held **13,783 showtime-page URLs**
on 2026-08-20, each `<changefreq>daily</changefreq>` with a same-day `<lastmod>`.

```
https://in.bookmyshow.com/movies/{cityCode}:{citySlug}/{movieSlug}-{cityCode}:{citySlug}/buytickets/{eventCode}[/{YYYYMMDD}]
```

The trailing date segment selects the show date, so a date range is just N URLs. No URL
guessing — the sitemap is the discovery mechanism.

### The pages render logged out

Verified by loading pages in a normal browser with **no BookMyShow session** (the "Sign
in" button rendered throughout). A plain HTTP GET returns only a React shell — the
`ld+json` blocks are generic `WebSite`/`Organization` boilerplate. **The data is
client-rendered, so any collector must execute JavaScript.** Once rendered, the page's
own hydration state (`window.__INITIAL_STATE__`) carries the structured payload.

### Fields observed

Per **venue** (`showtimeWidgets` → `groupList`):

| Field | Example | Notes |
|---|---|---|
| `id` / `additionalData.venueCode` | `PVMF`, `CPCK`, `SNYK` | stable theater identifier |
| `additionalData.venueName` | "Cinepolis: Centre Square, Kochi" | display name |
| `analytics.company_code` | `PVR` | exhibitor chain |
| `infoList[].label` | "Cancellation available" | venue policy chips |

Per **show** (`showtimesSections[].showtimes[]`):

| Field | Example | Notes |
|---|---|---|
| `additionalData.sessionId` | `42393` | **stable per-show ID** — the dedup key |
| `additionalData.availStatus` | `0`–`3` | **the demand signal** |
| `additionalData.showDateTime` / `showTimeCode` / `showDateCode` | — | scheduling |
| `additionalData.cutOffDateTimeEpoch` | — | booking cutoff |
| `title` | "09:00 AM" | display time |
| `subtitleAcronym` | `ENG`, `LUXE`, `PXL`, `Atmos` | language / format |
| `styleId` | `green-pill-with-border` | rendered demand colour |
| `filters` | `["pf3","pf4","pf8","tf1"]` | price-band + time-band tags |
| `cta.analytics.metadata` | `{"venue_info":["fast_filling"]}` | plain-text status label |

### The availability scale

Four states observed live across the Kerala sweep:

| `availStatus` | Pill | Label | Reading |
|---|---|---|---|
| `3` | green | *(none)* | wide open — **confirmed** |
| `2` | orange | `fast_filling` | filling — **confirmed** via analytics metadata |
| `1` | orange | *(none)* | distinct from `2`; **position on the scale unverified** |
| `0` | — | *(none)* | sold out / not sellable — **semantics unverified** |

Only `3` and `2` are evidenced. For `1` the evidence supports *distinct from 2*, not
*tighter than 2* — that ordering is inferred from the pill colour alone. Its
distribution is also uneven (13/150 in Kochi, 1/158 in Thiruvananthapuram, 5/5 in
Thalassery), so any headline number resting on it is provisional. The 48-hour delta
test in §9 settles it: if `1` really is tighter than `2`, shows should transition
2 → 1 and never 1 → 2.

`availStatus` is the field to normalize on. It is finer-grained than the UI (1 and 2
render the same colour) and far more stable than the styled-components class hashes
(`sc-1vhizuf-1 eUDeRW`), which change on every BookMyShow deploy.

**`availStatus: 0` must not be labelled "sold out" in code or UI until confirmed.** It
appeared only in Kollam (5 shows) and Alappuzha (8) and could equally mean cancelled,
blocked, or past cutoff.

## 3. What we cannot get

- **No seat counts.** Not total, not available, not sold.
- **No occupancy percentage.** No denominator exists, so the occupancy formula in the
  original brief is not computable and must not be shipped.
- **No exact ticket prices.** Shows carry price-*band* membership (`pf2`…`pf8`,
  `categoryId: "price"`), not amounts.
- **No screen name or capacity.** Format (LUXE/PXL/Atmos) is a proxy for screen
  identity, not the screen. Capacities differ, so raw cross-theater comparison of
  absolute numbers stays invalid.

Seat-level data lives behind the booking flow (`/seatlayout/`), requiring a logged-in
session and endpoints `robots.txt` explicitly disallows. **Out of scope** per project
constraint #6.

Note: the page's static config ships a *seat* legend (`1: Available`, `2: Sold`,
`4: Bestseller`). That is the booking flow's vocabulary, shipped to every client — it is
**not** evidence that seat data is reachable from the showtime page. It is not.

## 4. Compliance position

**In scope:**
- `/movies/.../buytickets/...` is **not** disallowed for `User-agent: *` — verified
  against the wildcard block of `robots.txt` on 2026-08-20. No `crawl-delay` applies to
  `*` (only PetalBot carries one).
- BookMyShow publishes these exact URLs in its own crawl sitemap, `changefreq: daily`.
- No login, credentials, or booking/seat-lock/payment action.
- No CAPTCHA, anti-bot, rate-limit, or access-control circumvention.

**Out of scope:** everything `robots.txt` disallows (`/payment*`, `/order-summary*`,
`/booking-details*`, `/getJSData/`, `/getHTML*`, `/ibv*`, `/m4/`, `/m5/`), plus seat-map
replay, session/cookie reuse, proxy or UA rotation, and 403 evasion.

**Residual risk:** BookMyShow's terms prohibit unauthorized scraping in general terms,
and robots.txt permission is not contractual permission. Volume is the main lever. Keep
scans to the cities and dates a live campaign actually needs. An authorized
distributor/exhibitor feed remains the preferred long-term source. This is a business
decision, not one the code can settle.

## 5. Region handling — a correctness trap

**The city in the URL is cosmetic.** BookMyShow resolves region from an `rgn` cookie.
During the spike, three different city URLs all returned Kochi data with the query key
still reading `KOCH`, and the URL silently rewrote itself to `/movies/kochi/...`.

With no `rgn` cookie at all, the page renders no showtime state whatsoever.

**The collector must set `rgn` explicitly per city and assert that the returned payload
key matches the requested region code.** Without that assertion this fails silently and
attributes one city's demand data to another — the worst possible failure mode for a
tool that decides where campaign money goes. `rgn` is a first-party region preference,
equivalent to picking a city in the UI; it is not session or credential reuse.

## 6. Live baseline — Bethlehem Kudumba Unit, Kerala, 2026-08-21 shows

All 30 Kerala city regions carrying the film were scanned.

**178 venue-city rows, 870 shows. 152 shows (17.5%) under any demand pressure; 718
(82.5%) wide open.**

| City | Venues | Shows | Sold out (0) | Nearly full (1) | Filling (2) | Wide open (3) | % under pressure |
|---|---|---|---|---|---|---|---|
| Kochi | 27 | 150 | 0 | 13 | 50 | 87 | 42% |
| Thiruvananthapuram | 30 | 158 | 0 | 1 | 15 | 142 | 10% |
| Thrissur | 22 | 113 | 0 | 1 | 6 | 106 | 6% |
| Kollam | 12 | 54 | 5 | 0 | 8 | 41 | 24% |
| Alappuzha | 11 | 47 | 8 | 0 | 0 | 39 | 17% |
| Palakkad | 11 | 44 | 0 | 0 | 0 | 44 | 0% |
| Kozhikode | 9 | 51 | 0 | 0 | 9 | 42 | 18% |
| Kottayam | 6 | 29 | 0 | 0 | 7 | 22 | 24% |
| Angamaly | 4 | 19 | 0 | 0 | 6 | 13 | 32% |
| Kallara | 4 | 19 | 0 | 0 | 3 | 16 | 16% |
| Vadakara | 4 | 17 | 0 | 0 | 0 | 17 | 0% |
| Pathanamthitta | 3 | 14 | 0 | 0 | 0 | 14 | 0% |
| Manjeri | 3 | 14 | 0 | 1 | 1 | 12 | 14% |
| Irinjalakuda | 3 | 15 | 0 | 0 | 2 | 13 | 13% |
| Changanassery | 3 | 13 | 0 | 0 | 1 | 12 | 8% |
| Kanhangad | 3 | 12 | 0 | 0 | 1 | 11 | 8% |
| Punalur | 3 | 12 | 0 | 0 | 0 | 12 | 0% |
| Kannur | 2 | 8 | 0 | 0 | 3 | 5 | 38% |
| Perinthalmanna | 2 | 9 | 0 | 0 | 0 | 9 | 0% |
| Thodupuzha | 2 | 10 | 0 | 0 | 2 | 8 | 20% |
| Muvattupuzha | 2 | 9 | 0 | 0 | 1 | 8 | 11% |
| Kunnamkulam | 2 | 8 | 0 | 0 | 1 | 7 | 13% |
| Kayamkulam | 2 | 9 | 0 | 0 | 0 | 9 | 0% |
| Kothamangalam | 2 | 9 | 0 | 0 | 0 | 9 | 0% |
| Thiruvalla | 1 | 5 | 0 | 0 | 2 | 3 | 40% |
| Ottapalam | 1 | 4 | 0 | 0 | 0 | 4 | 0% |
| Pala | 1 | 4 | 0 | 0 | 0 | 4 | 0% |
| Thalassery | 1 | 5 | 0 | 5 | 0 | 0 | 100% |
| Taliparamba | 1 | 5 | 0 | 0 | 0 | 5 | 0% |
| Goolikkadavu | 1 | 4 | 0 | 0 | 0 | 4 | 0% |

**Caveats on this table.** It is one snapshot of one show date — a single reading is not
a trend, and small-city percentages swing on one or two shows. Venue counts are
venue-*city* rows, not distinct theaters: BookMyShow city regions overlap
geographically (a Mookkannoor/Angamaly venue appears under both Kochi and Angamaly), so
the real distinct-theater count is lower and requires dedup by `venueCode`.

### Coverage — scope is BookMyShow-listed theaters only

The real Kerala footprint for this film is **285 theaters**. This sweep found **178
venue-city rows across 30 BookMyShow city regions**; the deduped distinct-theater count
is lower still, because BookMyShow city regions overlap geographically (a
Mookkannoor/Angamaly venue appears under both Kochi and Angamaly).

**Confirmed with the campaign owner (2026-08-20): not all 285 theaters sell through
BookMyShow, and the feature is intentionally scoped to those that do.** Many Kerala
single screens use local or counter booking only and are structurally invisible to this
data source. That is an accepted limitation, not a defect to engineer around.

Two things still follow from it:

1. **Label aggregates honestly.** A rollup like "17.5% of shows filling" describes the
   BookMyShow-listed subset, not the Kerala market. The UI should say so. A theater
   absent from BookMyShow is not a theater with no audience.
2. **Enumerate regions from BookMyShow, not the sitemap.** The 30 city regions here came
   from `sitemap/movie-shows.xml`, an SEO artifact with no completeness guarantee. A
   production collector should enumerate cities from BookMyShow's own region list and
   use the sitemap only to confirm URL shape — otherwise theaters that *are* listed
   could still be missed.

Deduping by `venueCode` is required before any distinct-theater count is displayed.

## 7. What this supports as a product

An **ordinal demand-pressure tracker**, not an occupancy monitor. Per show, store
`availStatus` over time; per theater, derive:

- share of shows at each demand level, now and as a trend;
- **transitions** — a show moving 3 → 2 → 1 is real demand movement, and time-to-
  transition is comparable across theaters in a way a raw snapshot is not;
- shows still at status 3 as the cutoff approaches — the underperformance signal;
- show count and format mix per theater per day (exhibitors cut shows when a film is not
  selling — an independent, publicly visible signal);
- price-band movement.

**Wording rules this imposes.** Never "occupancy", "tickets sold", "seats booked", or a
percentage-full. Use "demand level", "source-reported availability", "filling / wide
open", "shows retained". Store `availStatus` raw alongside any derived metric so a
BookMyShow change is detectable rather than silently remapped.

## 8. Collection approach

Plain HTTP is insufficient (React shell). Needs a **JavaScript-rendering** collector on
a robots-permitted URL: an Apify browser actor (Puppeteer/Playwright) whose page
function sets `rgn`, loads the page, asserts the region code, and reads
`window.__INITIAL_STATE__`. This runs through the existing `src/lib/apify/client.ts` +
`quotaBreaker.ts` seam like every other actor here — no second Apify client.

**Scope decision (2026-08-20, campaign owner): all Kerala cities on BookMyShow, and
every BookMyShow-listed theater playing the film — not a sampled subset.**

Volume: `cities × dates × 1 render` per scan. 30 Kerala city regions × 3 dates = 90
renders per scan; × 7 dates = 210. At 90-minute intervals that is roughly 1,400–3,400
renders/day. With the spend cap now at $1000 this is affordable, but it is real
third-party traffic and real money, so the interval is the lever to keep honest:
start at 90 minutes and only shorten it where the data proves it moves that fast.
Per-city results are independent, so a failed city must degrade to "not scanned" for
that city alone and never to "no demand".

### RESOLVED — automated collection is blocked. Tested 2026-08-20.

The actor permission was approved and the test was run. **It failed.**

`apify/web-scraper` (Puppeteer, Apify datacenter proxy, no stealth plugins) against one
Kochi showtime URL:

```
Request blocked - received 403 status code.   × 4  (initial + 3 retries)
```

The page never loaded. Follow-up measurements, same URL, within minutes of each other:

| Client | Result |
|---|---|
| Apify headless Puppeteer, datacenter proxy | **403** |
| `curl`, ordinary local connection, browser UA | **403** |
| Real Chrome, same local connection, same moment | **200, hydrates fully** |

Two conclusions follow, and the second is the important one:

1. **It is not an IP block.** A real browser on the very same connection that `curl` was
   refused from loads the page perfectly. So relocating the collector to a
   non-datacenter connection would not, on its own, fix this.
2. **It is request-fingerprint anti-bot protection.** BookMyShow (via its edge provider)
   distinguishes a genuine browser from an automated client — including a headless
   Puppeteer, which *is* a real browser engine. Notably, plain `curl` returned 200
   earlier the same day and 403 later, so the protection is adaptive or probabilistic
   rather than a static rule.

**Getting past this would require stealth fingerprinting** (`puppeteer-extra-plugin-
stealth`, fingerprint spoofing) **and/or residential proxy rotation.** That is precisely
the circumvention ruled out by project constraint #6 and by BookMyShow's own prohibition
on unauthorized scraping. **It is not being attempted, and it should not be.**

Note on method: every measurement in §2 and §6 of this document was collected through a
real browser session and remains valid. What is now established is that the same data
cannot be collected *automatically* by permitted means.

### Compliance guardrail for whoever implements this

The collector reads `window.__INITIAL_STATE__` **from the rendered page**. It must not
later be "optimized" into calling the underlying XHR endpoint directly. `/getJSData/`
and `/getHTML*` are robots-disallowed, and rendering the permitted public page is the
line the entire compliance position in §4 rests on. Do not drift across it.

**Apify account status (re-checked 2026-08-20, after the cap was raised):**
`maxMonthlyUsageUsd` is now **1000** with **$195.94** used. The spend cap is no longer a
blocker and the quota circuit breaker will close on the next successful run.

**Remaining blocker on step zero:** `apify/web-scraper` and `apify/puppeteer-scraper`
both return `403 full-permission-actor-not-approved` — Apify requires a one-time
per-actor permission approval in the console before either will run, because they
execute user-supplied page functions. This is a manual account action, not something the
integration can grant itself. Until it is approved, the cloud-IP question stays open.

## 9. Recommendation — do not ship automated scanning

The go/no-go in §8 came back **no**. BookMyShow's anti-bot protection blocks automated
clients, and the only ways through are the ones this project ruled out. Everything below
follows from that.

**What the data question established (still true, still useful):** BookMyShow's public
showtime pages carry a real, usable 4-level demand signal per show, with stable theater
and session identifiers, on a robots-permitted path. The *analysis* is sound. Only the
*collection* is blocked.

**What was built:** the full feature — schema, normalization, scoring, API, UI, tests,
docs — works end to end against the mock provider, which replays the real Kerala
measurements. It is not wasted: every layer above the fetch is independent of how the
data arrives, so it stays valid for any of the options below.

**Options, in the order I would pursue them:**

1. **Ask for authorized access.** BookMyShow, the distributor, or the theater chains.
   This is now the only route to *automated* data, and it is the one that yields better
   data anyway — real occupancy rather than an ordinal label. A distributor doing paid
   Kerala campaigns has a legitimate commercial ask here.
2. **Periodic manual capture.** The browser path still works. A person opening the
   showtime pages for the target cities once or twice a day, with a small paste-in or
   file-upload path into the existing ingest, would populate the same tables and light up
   the same UI. Unglamorous, entirely above board, and probably sufficient for a campaign
   that runs a few weeks.
3. **Drop the BookMyShow dependency** and keep only what is independently observable —
   show counts and screen retention per theater, which a person can read off the page
   quickly, or which exhibitor contacts will tell you directly.

**What not to do:** stealth fingerprinting, residential proxy rotation, or retrying
through anything designed to look like organic user traffic. Beyond the terms question, a
distributor running recognisable campaigns in Kerala is not well placed to be caught
circumventing a ticketing platform's bot protection.

Unchanged regardless of route: do not ship the occupancy percentage, the seats-per-hour
velocity metric, or any "tickets sold" wording. The source does not support them.

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
| `3` | green | *(none)* | wide open |
| `2` | orange | `fast_filling` | filling |
| `1` | orange | *(none)* | tighter than `2` |
| `0` | — | *(none)* | sold out / not sellable — **semantics unconfirmed** |

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

### Coverage gap — the most important open item

The confirmed real footprint is **285 Kerala theaters** playing this film. This sweep
found **178 venue-city rows across 30 BookMyShow city regions**, and the deduped
distinct-theater count is lower still (regions overlap — a Mookkannoor/Angamaly venue
appears under both Kochi and Angamaly).

**So BookMyShow sees at best ~62% of the real Kerala footprint, and likely less.**

Three candidate explanations, in order of expected contribution:

1. **Theaters that do not sell through BookMyShow at all.** Many Kerala single screens
   use local/counter booking only. These are structurally invisible to this data source
   and always will be.
2. **Incomplete region enumeration.** The 30 city regions came from
   `sitemap/movie-shows.xml`, which is an SEO artifact and carries no completeness
   guarantee. BookMyShow's own region list may contain Kerala regions the sitemap
   omits. **A production collector should enumerate cities from BookMyShow's region
   list, not from the sitemap**, and treat the sitemap purely as URL-shape confirmation.
3. Venue-region overlap — this *reduces* the count further, so it widens the gap rather
   than closing it.

**Consequence for the product, and it is not a small one.** A theater absent from
BookMyShow is not a theater with no audience. Any Kerala-wide rollup ("X% of shows
filling") computed over BookMyShow venues alone is a statement about the BookMyShow
subset, not about Kerala, and must be labelled that way. Per-theater signals stay valid
for covered theaters; aggregate market conclusions do not.

**Before trusting any Kerala-wide number, reconcile the 285-theater list against
`venueCode` coverage** and record which theaters are out of scope. That reconciliation
is a prerequisite, not a nice-to-have.

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

Volume: `cities × dates × 1 render` per scan. All 30 Kerala cities × 7 dates = 210
renders per scan, too much to run hourly. A realistic MVP is 6–10 target cities × 3
dates ≈ 18–30 renders per scan at 60–90 minute intervals. Cost needs sizing against real
actor pricing before `BOOKMYSHOW_MONITORING_ENABLED` is flipped on.

**Blocker on live verification:** the Apify account is past its monthly spend cap
($29.24 / $29) and self-heals around **2026-08-30**. Until then fixtures/mock are the
only working path and the opt-in integration test cannot pass.

## 9. Recommendation

Proceed, scoped as a demand-pressure and show-retention tracker.

Three things still need confirming before the schema is fixed:

1. The semantics of `availStatus: 0`.
2. Whether `availStatus` moves observably within a day — a signal that never changes is
   not a signal. Both (1) and (2) are answered by logging a sample of shows every 30
   minutes for ~48 hours and reading the deltas. Cheap, and it de-risks the data model.
3. **The 178-vs-285 coverage gap (§6).** This one is a go/no-go input, not a detail: it
   sets whether this tool reports on Kerala or on the BookMyShow subset of Kerala.

Do not ship the occupancy percentage, the seats-per-hour velocity metric, or any
"tickets sold" wording from the original brief. The data does not support them.

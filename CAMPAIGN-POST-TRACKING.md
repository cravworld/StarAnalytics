# Campaign Post Tracking

Scoutline answers *"who should we give this campaign to."* This answers the next question:
*"they posted — what did we actually get."*

One tracked post = one link you paste. Everything else (grid, leaderboard, per-account
split, campaign totals, growth over time) is a view over the same four tables.

**Read §1 before promising anyone a "total reach" number.** The metric ceiling is the one
thing on this feature that cannot be engineered around, and it changes what the screens can
honestly show.

**Operating constraint, fixed 2026-08-21:** the only thing we ever receive from an
influencer is the post link. No Insights screenshots, no exports, no cooperation of any
kind. Everything this feature knows, it scrapes. That makes §1's ceiling permanent rather
than provisional — see §1c.

**Status: Phase 1 shipped (PR #52, merged 2026-08-21).** All three platforms are wired; Facebook
is built but not yet run against a real page (§4a). The migration is applied and verified at
zero drift against the schema.

| Piece | Where |
|---|---|
| Schema + migration | `prisma/schema.prisma`, `prisma/migrations/20260821120000_add_campaign_post_tracking/` |
| Link parsing | `src/lib/tracking/postUrl.ts` |
| Derived metrics | `src/lib/tracking/insights.ts` |
| Provider seam | `src/lib/tracking/provider.ts` |
| Ingest + queries | `src/lib/data/trackedPosts.ts` |
| Server actions | `src/lib/actions/trackedPosts.ts` |
| Screens | `src/app/(app)/campaigns/tracker/` |
| Components | `src/components/tracking/` |

---

## 1. What we can actually measure

These are other people's accounts. Graph API insights are first-party only —
`isInstagramInsightsLive()` is false in every real deployment anyway — so every number here
comes from a public scrape. Measured against what this repo already confirmed
(`apify-normalize.ts` header comment, `APIFY-USAGE-AUDIT.md` §K, `youtube-public-content.ts`),
plus the Facebook actor schemas checked 2026-08-21:

| Metric | Instagram | Facebook | YouTube |
|---|---|---|---|
| Likes / reactions | ✅ `likesCount` | ✅ + reaction breakdown | ✅ `likeCount` |
| Comments | ✅ `commentsCount` | ✅ | ✅ `commentCount` |
| Shares | ❌ never exposed | ✅ | ❌ |
| Views / plays | ✅ **video/reel only**, paid tier — see §1a | ✅ `viewsCount` (video posts) | ✅ `viewCount` |
| **Reach / impressions** | ❌ **never** | ❌ **never** | ❌ **never** |
| Saves | ❌ | ❌ | ❌ |

Three consequences, and they are not negotiable:

1. **There is no reach number and there never will be.** Reach is a private Insights metric
   on someone else's account. `apify-normalize.ts` already maps `videoViewCount` to null
   specifically so a play count cannot masquerade as reach. A "Total Reach" tile on this
   feature would be fabricated — the exact failure mode commit `144f2b3` was written to fix.

2. **The three platforms are not on one axis.** Shares exist only on Facebook, views only on
   YouTube (and IG, conditionally). Summing them into one "total engagement" figure silently
   treats a missing metric as a zero.

3. **So the cross-platform axis is `likes + comments`.** That's the only pair all three
   report. Everything else renders per-platform, with coverage stated in words:
   *"Views: 12 of 34 posts (YouTube + IG Reels only)."* Nulls stay null, never coalesced to
   0 — same discipline as `ScoutScore` and `buzzScore.ts`.

### 1a. Instagram views: a deliberate, scoped reversal of audit finding K — DECIDED

**Decision, 2026-08-21: enabled.** Direction was explicit — "I don't mind paying extra, I
need the data." The rest of this section records why the surcharge is correct *here* and
must not be reverted.

`APIFY-USAGE-AUDIT.md` §K pinned `dataDetailLevel: "basicData"` because the paid
`detailedData` tier (+$0.0008/post, a ~53% surcharge) bought a `videoPlayCount` that
**nothing consumed**. That reasoning was correct then and stays correct for every existing
call path.

This feature *would* consume it. Reel play count is the single most-asked-for number on an
influencer deliverable, and without it Instagram — the platform most of this campaign runs
on — reports likes and comments only.

So: opt into `detailedData` **on the tracked-post scrape path only** — every existing call
path stays pinned to `basicData`, because finding K's reasoning still holds for all of them.
Store it in a column named `views`, and never let it touch `reach`.

Cost at 100 tracked posts re-scanned daily for a month is ~$6.90 against ~$4.50 on the basic
tier — the views themselves cost about **$2.40/month**, less once §6's taper stops scanning
settled posts daily.

Two constraints that ride along with this decision:

- **It is a play count, not reach.** A count of video starts is not a count of distinct
  people. `apify-normalize.ts` maps `videoPlayCount` to null today precisely so it can't
  masquerade as reach, and that guard stays — this feature adds a *separate* `views` column
  rather than loosening it. Label it "plays" in the UI.
- **It is a video field.** Reels and videos have a play count; a static photo or carousel
  does not. Those posts will show no view number no matter which tier we pay for — see §1c
  for the only route to a number on those.

**This must be commented at the call site as a scoped exception**, with a pointer back to
this section — otherwise the next person reading finding K will "re-fix" it to `basicData`
and silently blank the views column across the whole feature.

### 1b. Instagram Stories cannot be tracked this way — flag this early

`ScoutBatchEntry.deliverable` already carries `STORY` from the source sheets, so story
deliverables are real here. A story expires in 24 hours and has **no permanent URL** — there
is nothing to paste, and nothing to re-scan. Link-based tracking cannot capture stories
retroactively, and a story that has expired is gone.

If story deliverables need to be counted, that's a separate manual-capture path — see §1c,
which is the same mechanism. Better to name that gap now than to have the campaign totals
quietly under-count half the deliverables.

### 1c. There is no reach number. This is permanent, not "not yet."

Reach is computed inside Instagram from the account owner's own Insights and is never
published on any public surface, at any price, to anyone but the owner. Enabling the paid
tier (§1a) buys **plays on videos** — it does not buy reach, saves, or anything at all on
static posts and carousels.

The one legitimate route was to ask the influencers for their Insights, since they are paid
commercial partners. **Ruled out 2026-08-21:** direction is that nothing comes back from
them except the post link. That closes the question.

So, settled and not to be re-proposed:

- **No reach, on any platform, ever.** Not a roadmap item. Any tile labelled "reach" would
  be fabricated.
- **No saves.** Same reason.
- **No stories** (§1b) — no URL exists to scrape, and no one will send us the numbers.
- Everything derived — engagement rate, view rate — is measured **against follower count**,
  which is a public proxy for audience size, *not* reach. Label it as such once, in the UI,
  and the four views can then stop hedging on every number.

This is not as thin as it sounds. §7 lists what is genuinely computable from likes,
comments, views, followers and snapshot history — including the one number that actually
answers "how are they performing": whether a paid post beat that account's own normal
engagement rate.

### 1d. No real post thumbnails

Instagram and Facebook CDN media URLs are hotlink-protected and expire within days, so a
stored URL renders as a broken image a week later. This is why the existing `/content` grid
draws `.post-thumb-icon` as a glyph rather than an `<img>` — the same constraint, already
met once in this codebase.

Grid cards therefore show a platform badge, a media-type icon, the handle, and the metrics.
Real thumbnails would mean proxying and storing third-party media, which is a storage cost
plus a `DATA-PRIVACY.md` question about holding other people's images. Out of scope, and
recorded here so it doesn't read as an oversight.

---

## 2. Schema

Additive only — four new tables and one new enum. The single touch to an existing model is
a back-reference field on `Campaign` (`trackedPosts TrackedPost[]`), which Prisma requires
for the relation but which adds no column to `campaigns` — the FK lives on `TrackedPost`.
Nothing existing is altered or dropped. (Migrations go live against the prod DB the moment
the PR's preview build goes green, so "additive only" is a hard requirement, not a
preference. Run `npm run db:validate` before opening the PR.)

```prisma
// A THIRD platform enum, deliberately.
//
// `Platform` (instagram|youtube) is welded to the PlatformId union in providers/types.ts —
// ~79 narrowing sites across the Graph-API features. The schema records that adding
// `facebook` to it was tried and reverted for exactly that reason.
// `ScoutPlatform` (instagram|facebook) drives Scoutline's actor/normalizer dispatch —
// ~27 sites, all of which would break on a `youtube` variant they have no scan logic for.
// This feature is the only one that needs all three. A third enum on brand-new tables
// breaks nothing; widening either existing enum breaks a hundred call sites in features
// that have no stake in this one.
enum TrackPlatform {
  instagram
  facebook
  youtube
}

model TrackedAccount {
  id           String        @id @default(uuid())
  platform     TrackPlatform
  handle       String
  displayName  String?
  // "instagram:somehandle" — same platform-prefixed dedup discipline as
  // ScoutCandidate.profileUrlKey.
  accountKey   String        @unique

  // Soft link back to Scoutline, INTENTIONALLY not a relation — a plain id, no FK.
  // An account can be tracked without ever having been scouted, and this feature must not
  // acquire a hard dependency on a Scoutline table it doesn't own. When set, it's what
  // makes "promised vs delivered" possible: the candidate's snapshot has the follower
  // count the pick was made on.
  scoutCandidateId String?
  trackedPosts     TrackedPost[]
  snapshots        TrackedAccountSnapshot[]
}

// Follower history for the posting account. This is the table that makes every derived
// insight in §7 possible — engagement rate needs a denominator, and the denominator moves.
// Scraped once per account per day at most, NOT once per tracked post: 20 posts from 5
// accounts is 5 profile scrapes, not 20.
model TrackedAccountSnapshot {
  id         String         @id @default(uuid())
  accountId  String
  account    TrackedAccount @relation(fields: [accountId], references: [id])
  followers  Int?
  // False when the platform didn't report a follower count (private/limited profile).
  // Null followers with this false means "unknown", never zero — an ER computed against
  // an unknown denominator is not rendered at all.
  followersAvailable Boolean @default(true)
  capturedAt DateTime       @default(now())
  raw        Json?

  @@index([accountId, capturedAt])
}

model TrackedPost {
  id         String        @id @default(uuid())
  campaignId String
  campaign   Campaign       @relation(fields: [campaignId], references: [id])
  accountId  String
  account    TrackedAccount @relation(fields: [accountId], references: [id])
  platform   TrackPlatform
  url        String
  // Shortcode (IG) / videoId (YT) / postId (FB). Composite unique, not bare: the three
  // ID spaces overlap — same reasoning as Post's @@unique([platform, igShortcode]).
  postKey    String
  mediaType  String?
  caption    String?
  postedAt   DateTime?

  addedAt       DateTime  @default(now())
  isActive      Boolean   @default(true)
  lastScrapedAt DateTime?
  lastError     String?

  // Denormalized current + previous metrics. NOT redundant with the snapshot table —
  // see §5: the grid must not run one query per card.
  curLikes    Int?
  curComments Int?
  curShares   Int?
  curViews    Int?
  prevLikes    Int?
  prevComments Int?
  prevViews    Int?

  snapshots TrackedPostSnapshot[]

  // Global, so a given post can be tracked under exactly ONE campaign. That is almost
  // certainly what's wanted, but state it: the agency pipeline hit this exact shape (the
  // same post listed under two agencies in one sheet) and had to dedup around it. A post
  // promoting two films at once would surface here as "already tracked" rather than as a
  // bug — if that case is real, this needs to become @@unique([campaignId, platform, postKey]).
  @@unique([platform, postKey])
  @@index([campaignId, accountId])
}

// Append-only. A re-scan adds a row, never overwrites — same discipline as
// AccountSnapshot / ScoutSnapshot / CampaignBuzzSnapshot. This is what turns
// "how is it performing" from a number into a curve.
model TrackedPostSnapshot {
  id            String      @id @default(uuid())
  trackedPostId String
  trackedPost   TrackedPost @relation(fields: [trackedPostId], references: [id])
  capturedAt    DateTime    @default(now())

  // Every metric nullable. Null means "this platform/tier does not report it",
  // never zero. See §1.
  likes     Int?
  comments  Int?
  shares    Int?
  views     Int?
  reactions Json?   // FB's love/haha/wow/care breakdown; null elsewhere

  // Nullable so prune-raw-payloads can clear it after RAW_PAYLOAD_RETENTION_DAYS,
  // same as Post.raw / ScoutSnapshot.raw. Add this table to that cron in the same PR —
  // ScoutSnapshot.raw was collected for weeks before anyone noticed it wasn't pruned.
  raw Json?

  @@index([trackedPostId, capturedAt])
}
```

**No new run table.** `ScrapeRun.kind` is a plain `String` — use `kind: "tracked-posts"` and
reuse the existing async pattern (row + `after()` + status poll) that
`runAgencyBatchJob` / `/api/agency-run/[id]/status` already prove out.

### 2a. Why not reuse `Post`

`Post` looks like it fits and doesn't:

- `@@unique([platform, igShortcode])` with mutually-exclusive nullable FKs
  (`campaignId`/`agencyId`/`fanPageId`/`competitorId`). The same Instagram post uploaded once
  as an agency deliverable and once as a tracked campaign post is **one row** — whichever
  path scrapes last stomps the other's `source` and `scrapedAt`.
- `Post` holds one set of metrics and overwrites on re-scrape. There is no history, which is
  most of what this feature is for.
- `Platform` has no `facebook` (§2).

---

## 3. Screens

Route: `/campaigns/tracker` (index) and `/campaigns/tracker/[campaignId]` (detail).

**Register the subroute in `src/lib/campaignRoutes.ts`.** That file's own comment records
that the list drifted twice and that a missing entry is *silently* misclassified as a
campaign-detail view — wrong breadcrumb, wrong `aria-current`. Its `startsWith` check already
anticipates a nested detail route, so `/campaigns/tracker/[id]` needs no other change.

The detail page carries four views over one dataset:

**Grid — sectioned by posting account, not one flat wall.** This is the "check the page
which has posted it and group them based on that" ask read literally: each posting account
gets its own headed section (handle, follower count, posts in this campaign, that account's
total engagement), with its post cards inside it. One flat grid with an account dropdown is
a different, worse thing — it makes you filter to compare instead of letting you see all
accounts at once.

Each card: platform badge, media-type icon (§1d — no real thumbnails), posted date,
likes/comments/views, engagement rate, and the delta since the previous scan (`cur* −
prev*`, the thing a single scrape can never show). A flat "all posts" mode and
platform/date filters sit alongside the grouping, not instead of it.

**Leaderboard** — sortable table, all posts. Sort by engagement, by views, by engagement rate
against the account's follower count, by date. Follow `ScoutLeaderboardFilterable` — same
interaction, and users already know it from Scoutline.

**By account** — the "account wise / page wise split". One row per influencer: posts
delivered, total engagement, average per post, best post, and engagement rate against the
follower count Scoutline recorded when they were picked. This is where the two features earn
each other: **promised vs delivered.** `ScoutBatchEntry.deliverable` already stores what the
source sheet committed to (`STORY`/`REEL`), so "committed 2 reels, 1 tracked" is computable
today — subject to §1b for stories.

*(Reading "page wise spilt" as per-account breakdown, since "page" means an IG account
everywhere else in this app — cf. Fan Pages. Pagination is table stakes and is separate.)*

**Totals** — KPI header. Posts tracked, accounts, total likes + comments, and per-platform
native metrics each with explicit coverage ("Views: 12 of 34 posts"). No reach tile. Ever.

---

## 4. Ingest

One function, from day one:

```ts
ingestTrackedPostUrls(campaignId: string, urls: string[]): Promise<IngestResult>
```

It takes an array immediately even though the first UI passes exactly one. Bulk upload later
is then a *parser* in front of the same function (`parseAgencySheet.ts` is the precedent),
not a second pipeline that drifts from the single-URL path.

**URL parsing** needs a shared `src/lib/tracking/postUrl.ts`. Two thirds of it already exist
but are private: `extractShortcode` in `data/agency.ts` (IG) and `parseVideoId` in
`youtube-public-content.ts` (YT). Extract both, add Facebook.

Facebook is the hard one — it has no single canonical post-URL shape:

```
facebook.com/{page}/posts/{id}
facebook.com/permalink.php?story_fbid={id}&id={pageId}
facebook.com/{page}/videos/{id}
facebook.com/reel/{id}
facebook.com/watch/?v={id}
facebook.com/share/p/{hash}      <- opaque, NOT resolvable without following a redirect
```

The `/share/p/` form is what the mobile share sheet produces, so it's the one people will
actually paste. It carries no post ID — resolving it needs an HTTP follow. Handle it
explicitly (resolve, or reject with a message telling the user to paste the permalink);
do not let it fall through as an unparseable URL.

**Provider seam.** Scrape logic goes behind a `TrackedPostProvider` interface in
`providers/`, mock and live, like everything else. Two live-path landmines:

- `YouTubePublicContentProvider.scrapeByUrls` hardcodes `source: "agency"` and persists into
  `Post` (`youtube-public-content.ts:148`). Routing tracked videos through it would
  mis-stamp every one of them. Call `videosByIds` directly, or parameterize.
- The Apify quota breaker is account-wide. When it trips, a partial batch must be recorded as
  an **error** on the `ScrapeRun` row, not scored as if complete — `runAgencyBatchJob`'s
  comment on rethrowing explains why.

Batch at 200 URLs per run, reusing `AGENCY_SCRAPE_BATCH_SIZE` rather than inventing a
second ceiling.

### 4a. Facebook — BUILT via page-scrape-and-match (2026-08-21)

**There is no Apify actor that takes a Facebook post URL and returns that post's metrics.**
Not a gap in the search — a gap in Facebook's tooling. Apify's official collection has ~17
Facebook actors and every one is organised by *container*: page, group, event, hashtag,
search, marketplace, reels, reviews.

Two official actors do accept post URLs, and neither helps:

- `apify/facebook-comments-scraper` returns the comment list, not counts.
- `apify/facebook-likes-scraper` sounds exactly right and is a trap. It returns **one row
  per person who reacted** — name, profile URL, profile picture, Facebook ID — and by its
  own docs only a ~20-row *preview* per post, so it cannot produce a true count at all. It
  bills $2.60/1,000 rows, and it would harvest the personal data of thousands of uninvolved
  third parties, which is the exact inverse of the data-minimization pass in
  `apify-normalize.ts`. Disqualified three times over.

This asymmetry with Instagram is structural, not incidental: an Instagram post has one
canonical shortcode URL, so `apify/instagram-post-scraper` can key on it. A Facebook post
has six URL shapes, some of which resolve only behind a login redirect.

**So the route is: scrape the post's page, match our post ID out of the results.**

#### What makes that precise rather than a guess

`apify/facebook-posts-scraper` takes **`onlyPostsNewerThan`**, accepting a date or a
relative expression ("2 months"). Each run is therefore bounded to just before the oldest
post we track on that page — guaranteed to reach every one of them, and nothing older.

The original worry was that a page scraper walks only *recent* posts, so a tracked post
could age out of the window and vanish silently. Two things killed that objection:

1. **The date bound removes the guesswork.** We are not hoping a fixed `resultsLimit` went
   deep enough; we state the cutoff.
2. **Measured posting frequency says the window is generous.** Across this account's own
   2,113 Scoutline snapshots, influencers post a **median of 1.06 posts/week** (p90 3.8).
   To still reach a 30-day-old post takes ~5 items at the median and ~17 at p90; 60 days
   takes ~10 and ~33. These are not brands posting five times a day.

`APIFY_FB_INITIAL_LOOKBACK` (default "3 months") covers the first ingest, when the post's
date isn't known yet. `APIFY_FB_MAX_POSTS_PER_PAGE` (default 200) is the ceiling for the
outlier case — the same dataset has a maximum of 112 posts/week, and one tracked post should
not become an unbounded bill.

#### One run per page, not per post

Three posts from the same influencer is one scrape, not three. Posts are grouped by the page
derived from their own URL (`facebookPageFrom`), so cost scales with accounts, not posts.

#### Where it still can't reach, and why that's said out loud

`/reel/{id}`, `/watch/?v={id}` and `/share/p/{hash}` name a post and nothing else — there is
no page in the URL to scrape. Those are **not** silently skipped: the operator gets
"That Facebook link names the post but not the page it's on… copy the URL from the address
bar", which is fixable in ten seconds. A post that scrapes but isn't found gets a different
message again ("Not found among that page's recent posts"), because "your URL is the wrong
shape" and "your post may have been deleted" send someone to check very different things.

Nothing anywhere returns a fabricated zero.

#### Matching on every ID form

A pasted link may key on a `pfbid…` permalink token while the actor reports the numeric ID —
or the reverse. `facebookPostKeys()` indexes every form a returned post could be matched by,
because matching on one alone silently drops the other.

#### Not chosen: `scrapyspider/facebook-post-scraper`

The community post-URL actor works and is cheap (~$0.001/post), but returns no view counts
and has 206 total users with no ratings. It stays the documented fallback if the official
actor disappoints on real pages — the provider seam makes that a one-file swap.

#### Still unverified

The field names above come from the actor's documentation, not from a live run against a
real page. `apify-scout-normalize-facebook.ts` records this repo's own hard-won lesson that
Facebook scrapes come back less consistently shaped than Instagram's — one of three live
test pages returned an empty dataset outright. The normalizer is therefore written with
fallbacks on every field and returns null rather than 0 for anything absent, and
`apify-normalize-facebook-posts.test.ts` pins that behaviour. **The first real Facebook link
is still the test that matters.**

Note this is a different question from Scoutline's. Scoutline runs
`apify/facebook-pages-scraper` deliberately page-only because it scores *accounts*; tracking
scores *posts*. The follower-count path here reuses that same actor and normalizer, since
the follower number is the same number.

---

## 5. Two things that will break this if ignored

**Query fan-out.** The pool is 5 connections. A grid of N post cards each fetching its own
snapshot history is precisely the shape that took `/fan-pages` down at ten tracked pages —
six queries per page, then `P2024 Timed out fetching a new connection from the connection
pool`. It is the recurring way screens here break as data grows, and it's about concurrent
query *count*, so it bites regardless of how fast any single query is. That is why §2
denormalizes `cur*`/`prev*` onto
`TrackedPost`: **the grid reads one table with one query.** The snapshot table is history —
only the per-post trend chart touches it. Add a query-count test mirroring
`campaignsQueryCount.test.ts`: assert the count at 1 post equals the count at 40, rather than
asserting a fixed number.

**Blocking on scrapes.** `apify/client.ts` warns that a route killed mid-wait orphans a
billed run. Ingest writes a `ScrapeRun` row, returns immediately, does the work in `after()`,
and the client polls a status route. Re-scans go through a cron, never a page load.

---

## 6. Re-scan cadence

A new `api/cron/rescan-tracked-posts` (`CronLock` + `vercel.json`), daily.

Posts stop moving long before we stop paying to ask. Taper rather than re-scanning
everything daily forever — and taper on **observed delta, not on an assumed decay curve**,
so the rule is measured rather than inherited from an industry stat nobody here checked:

- Default to daily while a post is still moving.
- Three consecutive scans with < 1% delta → drop to weekly.
- Three more flat weekly scans, or age > 60 days → stop; mark `isActive = false`.
  A manual "Refresh" always overrides.

Age is the backstop, the delta is the signal. Once a few weeks of real snapshots exist, the
actual decay curve is measurable from `TrackedPostSnapshot` and these thresholds can be
retuned against it instead of guessed.

Without a taper this quietly becomes the largest recurring Apify spend in the app, buying
identical numbers.

---

## 7. Derived insights — what "how are they performing" actually resolves to

No extra scraping. All of this comes from likes, comments, views, follower count and
snapshot history, and every one of them is defensible.

**Engagement rate** — `(likes + comments) / followers × 100`. The industry-standard measure,
and the only one that compares a 5k-follower account fairly against a 500k one. Rendered
only when `followersAvailable` is true; an ER against an unknown denominator is omitted, not
shown as zero.

**Beat-their-own-baseline — the headline number.** Scoutline already stored
`ScoutSnapshot.engagementRatePct` for every account it scanned, and
`apify-scout-normalize.ts` documents the actor's formula as *"mean of
(likes+comments)/followers×100 per analyzed post"* — **the same formula, same denominator**
as the per-post ER above. So the comparison is real, not a units mismatch: one paid post's
ER against the mean of ~100 of that account's own posts.

That answers the question a campaign owner actually has: *did the post they were paid for
do better or worse than what they put out for free?* An influencer whose sponsored post
underperforms their own average by 40% is the single most actionable thing this feature can
surface.

Two honesty constraints, both to be enforced at the call site:
- Cite the formula source in a comment where the delta is computed. If Scoutline's actor
  ever changes its formula, this comparison silently becomes wrong.
- The baseline was measured against that account's follower count *at scan time*, and only
  exists for accounts that went through Scoutline. Show it as "vs their Scoutline baseline",
  with the scan date, and omit it entirely for accounts that were never scouted.

**Comment ratio** — `comments / (likes + comments)`. Separates conversation from passive
scrolling. A high ratio on modest likes is often worth more to a campaign than the reverse,
and it's a cheap tell for engagement-pod behaviour when it's wildly out of line with the
account's norm.

**View rate** — `views / followers`, reels and YouTube only. Above 1.0 means the post
travelled beyond the follower base — the closest honest proxy for "did this spread" that
exists without reach.

**Velocity** — engagement gained per day since posting, straight from `TrackedPostSnapshot`.
Needs two scans to mean anything, which is exactly why the snapshot table exists.

**Rank and percentile** — within the campaign, and within that account's own tracked posts.

Nothing here needs a metric we cannot get. That is the point.

## 8. Suggested phasing

**Phase 1 — the useful core. BUILT 2026-08-21.** Schema + migration. Instagram and YouTube
ingest (the ingest function takes an array from day one; the UI passes a textarea's worth).
All four views. A manual "Refresh metrics" button. Usable on the current campaign without
waiting on the Facebook decision.

Verified: 342 unit tests pass, including the null-discipline suite in
`src/lib/tracking/insights.test.ts` and the fan-out guard in
`src/lib/data/trackedPostsQueryCount.test.ts`. `next build` clean, both routes registered.
NOT verified at runtime — the tables do not exist until the migration applies, so nothing
has exercised the real ingest path against a real link yet. That is the first thing to do
after deploy (§10).

**Phase 2 — coverage.** Facebook, after §4a is settled against real URLs. The re-scan cron
with taper. Deltas become meaningful once there are two scans to compare.

**Phase 3 — scale and depth.** Bulk upload (sheet parser in front of the Phase 1 function).
CSV export via the existing `CsvExportRegistrar`. Per-post trend charts.

*(The influencer-reported-metrics form that used to sit in this phase is deleted — see §1c.
Do not re-propose it; the input it depends on does not exist.)*

**Not now: comment sentiment on tracked posts.** Claude, OpenAI and Gemini credits are all
exhausted as of 2026-08-20 and `SENTIMENT_CLASSIFY` gates classification off. Comments can
still be *scraped* and stored; classification is a Phase 4 that starts when credits return.

---

## 9. Open questions

**Answer this one before the migration — it's the only one that gets expensive later:**

**Do tracked posts hang off existing `Campaign` rows?** The current `Campaign` model is
shaped for film promotion (hashtags, buzz snapshots, live/planned). Influencer campaigns may
be the same objects or a sibling concept. This design assumes reuse — a
`TrackedPost.campaignId` FK to `Campaign`. If they're actually a different thing, that FK
should point somewhere new. Re-pointing a FK after rows exist means a data migration; before
it, it's a one-line edit.

The rest can be answered while Phase 1 is being built:

- **Facebook** — §4a's two-actor test needs 3–5 real campaign URLs, one of them 30+ days
  old. Until that runs, Facebook ingest is stubbed and fails loudly (§4a).
- **Story deliverables** — §1b. If stories were commissioned, campaign totals will
  under-count them and nothing can be done about it; worth knowing how much of the buy that
  represents so the totals can be read correctly.

**Settled:**
- Instagram `detailedData` opt-in — enabled (§1a).
- Influencer-reported metrics — ruled out, no cooperation beyond the post link (§1c).
- Reach and saves — permanently unavailable (§1c). Not a roadmap item.

---

## 10. First run after deploy

The migration applies when a PR's preview build goes green — that is also when
`tracked_posts` and friends first exist. Until then every tracker screen 500s, which is
expected, not a bug.

Once it is live, in this order:

0. **Confirm the migration applied cleanly** — run `prisma migrate diff --from-schema-datasource --to-schema-datamodel` and expect zero drift. The migration SQL was hand-authored (it could not be generated locally: `.env.local` points at the production database, so `migrate dev` would have applied it there immediately), so this is the only real check that the field-by-field cross-read against the schema was complete.
1. **Paste one real Instagram reel link** into a campaign. Confirm the account is detected,
   the follower count lands, and a play count appears. If views come back empty, the §1a
   `detailedData` opt-in is not reaching the actor — check `APIFY_ACTOR_POST` is the post
   scraper and not a profile actor.
2. **Paste one real Instagram photo link.** Views should be blank ("—"), not zero. If it
   renders 0, the null discipline has broken somewhere between the normalizer and the view.
3. **Paste one YouTube link.** Confirm it groups under the channel, not under a display
   title, and that the subscriber count lands.
4. **Press "Refresh metrics"** and reload after a minute. The second scan is what makes the
   delta column and velocity mean anything — until then both are correctly blank.
5. **Check an account that came through Scoutline** shows the "vs own baseline" chip. If no
   account shows it, the `scoutCandidateId` link is not resolving — the lookup matches
   `ScoutCandidate.profileUrlKey` exactly, so a format drift on either side breaks it
   silently.

## 11. Known gaps

- **Facebook is built but never run against a real page** (§4a). Field names come from the
  actor's docs, not a live run, and this repo already knows Facebook payloads are
  inconsistently shaped. The normalizer has fallbacks everywhere and returns null rather
  than 0, but the first real link is the test.
- **Facebook `/reel/` and `/watch/` links can't be tracked** — they name the post but not
  its page, and there is no post-by-URL actor to fall back on. The operator is told to paste
  the address-bar permalink instead (§4a).
- **No re-scan cron yet** (§6). Metrics move only when someone presses Refresh, so velocity
  stays blank until a post is scanned twice.
- **No spreadsheet upload yet** (Phase 3). Page subscriptions (§13) now cover the common case — paste the page, not 40 links. The ingest function already takes an array and the form
  accepts multiple pasted links, so this is a sheet parser, not a new pipeline — but read
  §12 first: the write path must be moved off the request before a spreadsheet points at it.
- **No per-post trend chart.** `getTrackedPostTrend` exists and is tested by nothing that
  renders it.
- **Stories are uncountable** (§1b) and **reach does not exist** (§1c). Neither is a gap that
  can be closed.

---

## 12. Write-path query volume — bounded by time, not by the pool

§5 and `trackedPostsQueryCount.test.ts` cover the READ paths. The write paths are a
different shape and are deliberately not covered by that test, so state plainly what they
cost:

- `storeTrackedPost` issues roughly **6 queries per post**, serially: account lookup, an
  account create-or-update, a Scoutline lookup (new accounts only), a follower-snapshot
  staleness check, the post upsert, and the metrics snapshot insert.
- `refreshCampaignTracking` issues **2 queries per post**, serially.

Serial execution means these never hold more than one connection at a time, so this is NOT
the P2024 pool-exhaustion failure that took `/fan-pages` down — it is a **wall-clock**
concern. `addTrackedPostsAction` awaits its work (the caller needs the per-URL outcomes), so
a submission of 200 links would be well over a thousand sequential round-trips in a single
request and would time out long before it finished.

That is fine for Phase 1, whose stated use is pasting a handful of links at a time, and the
`MAX_URLS_PER_SUBMIT` cap of 200 is a security bound on a public POST endpoint, not a
promise that 200 works. **Before bulk upload ships (Phase 3), this must be moved behind a
`ScrapeRun` row + `after()` + status poll**, the way `runAgencyBatchJob` already handles a
few hundred URLs. Do not point a spreadsheet at the current path.

---

## 13. Whole-page tracking

Paste an influencer's **page or profile** link instead of a post link and the campaign
subscribes to that page: their existing posts are pulled in, and anything they post from
then on is picked up automatically by a cron. Same box, same textarea — ingest tries the
post parse first and falls back to the account parse, so nobody has to declare which kind of
link they pasted.

Direction (2026-08-21): *"I might also have to input whole page links, to track not just the
post, to track the whole page as such."*

### 13a. The problem a page import creates, and how it's resolved

An influencer's page mixes two things that look identical to a scraper: the posts they made
for the campaign, and their own everyday content. Counting the lot would put their holiday
photos into the client's engagement numbers. Filtering silently would drop real campaign
work whenever someone forgot the hashtag — and nobody would ever know what was missed,
because a filtered-out post is indistinguishable from a post that never existed.

So neither. **Everything the page returns is stored; a flag decides what counts.**

| | Counted in campaign totals | Visible |
|---|---|---|
| A link you pasted | ✅ always | ✅ |
| Discovered post mentioning a campaign hashtag | ✅ automatically | ✅ |
| Any other post from that page | ❌ | ✅ under "not counted", one click to include |

`tracked_posts.is_campaign_post` carries the decision; `discovered_via` records whether the
post was pasted or found by a page scan, so the UI can explain itself.

The third row is the important one. The hashtag is the **only** automatic signal available —
all three campaigns have `start_date` and `end_date` NULL, so there is no date window to
scope by — and it will miss posts. Keeping the misses visible turns a silent data-quality
problem into a one-click decision.

**A human's decision is never overwritten.** Clicking "count this one" stamps
`included_by_user_at`, and `storeTrackedPost` deliberately omits `is_campaign_post` from its
update branch, so no later re-scan or discovery pass can quietly reverse it — an influencer
editing a hashtag out of an old caption must not silently drop a post from the totals.

Matching is word-boundaried and case-insensitive: `#np50` must not match `#np500`, and
nobody types hashtags consistently. `campaignHashtagMatch.test.ts` pins both directions,
plus regex metacharacters — campaign hashtags are operator-entered free text and reach a
`RegExp` constructor.

### 13b. Subscribing is instant; discovery is not

`subscribeToPage` records intent and returns. The scrape runs off-request via `after()`.

This is not an optimisation. A page yields up to `APIFY_TRACKED_DISCOVERY_LIMIT` (50) posts
and each goes through `storeTrackedPost` at ~6 sequential queries plus a follower scrape —
comfortably past the request budget. Awaiting it would time out on the first real page and
leave partial rows with no record of where it stopped. This is §12's warning arriving in
practice, which is why page import was built on the async path from the start rather than
being written synchronously and rewritten later.

The UI says so plainly ("their posts are being fetched in the background"), because
"1 page tracked" next to an empty grid otherwise reads as a failure.

### 13c. Ongoing discovery

`/api/cron/discover-tracked-pages`, every 10 minutes, `PAGE_DISCOVERY_BATCH` (default 2)
subscriptions per run, skipping any scanned within `PAGE_DISCOVERY_TTL_HOURS` (default 12).

Batched for the reason `refresh-fan-pages` documents at length: one page is a full Apify
run, so a single invocation walking every subscription cannot fit in any function time limit
once there are more than a handful. Selection is `last_discovery_at` ascending with nulls
first, so successive runs continue where the last stopped with no cursor to store, a
just-subscribed page is the most urgent, and a killed run changes nothing — pages it never
reached keep their old timestamp and come back next time.

`last_discovery_at` is bumped **on failure too**. It records when discovery was attempted,
not when it succeeded — the same distinction `Post.comments_scraped_at` exists to make.
Without it, one permanently broken page would be the stalest row on every pass and starve
every other subscription.

### 13d. Discovery does not reuse `scrapeByHandle`

`scrapeByHandle` looks like the obvious Instagram discovery call and would have introduced a
silent bug: it requests `basicData`, so every discovered reel would come back with no play
count and render "—" for plays — indistinguishable from the null discipline being broken, on
the platform most of the campaign runs on. `discoverInstagramAccountPosts` opts into the
paid detail tier under the same §1a exception as pasted posts.

Facebook needs no separate discovery path at all: `fetchTrackedFacebookPosts` already works
by scraping the page, because Facebook has no post-by-URL actor (§4a). It is the one place
Facebook's awkward shape is an advantage.

YouTube resolves `/@handle` and `/channel/UC…`. Legacy `/c/` and `/user/` vanity URLs are
**rejected with an instruction**, not silently failed: they resolve through neither
`forHandle` nor `id`, only through `search.list` at 100 quota units against a 10,000/day
budget.

### 13e. Page-level metrics

Follower change across the tracked period, from the `tracked_account_snapshots` rows already
written on every scan — no extra query, built from the same result set the latest-follower
lookup uses.

Shown only with two or more readings. One snapshot is a reading, not a trend, and "+0" would
assert the count was measured twice and didn't move — a different claim from "we've only
looked once". Snapshots where the platform hid the follower count are dropped rather than
plotted as zero, which would draw a cliff that never happened.

### 13f. Privacy consequence, stated

A page subscription **widens what is collected** about a commercial partner: their
non-campaign posts are stored too. That is recorded in `DATA-PRIVACY.md` rather than left
implicit, and `tracked_page_subscriptions` is in the data-rights lookup's searched-tables
list with a specific note — **a deletion request must deactivate the subscription**, or the
next discovery pass simply re-adds everything that was deleted.

## 14. Account categories — influencers, vloggers, critics as sections

**The ask:** "is it possible to have a way to separately group the influencers, vloggers, fx
pages, movie reviewers, movie critics etc as different sections?"

A movie critic's post and a fan page's post are not comparable, and averaging them together
produces a campaign-wide engagement rate that describes nobody. Categories make the tracker
answer "how did the critics do" rather than only "how did everyone do".

### 14a. Where the category lives — on the account, not the post, not the pairing

On `TrackedAccount`. An account **is** a movie critic; that is a fact about them, not about
one campaign, so saying it once holds everywhere they are tracked. Storing it per
campaign-account pair would mean re-filing the same fifty people for every new campaign,
which is the kind of chore that stops getting done after the second campaign — at which
point the sections are wrong and worse than absent.

The consequence is stated in the UI rather than left to be discovered: the picker's tooltip
and the manager panel both say the label applies to every campaign the account appears in.

### 14b. A table, not an enum, not a string column

`tracked_account_categories` — id, name, `sort_order`.

- **Not an enum.** "etc." was in the ask. A new kind of account must not need a migration.
- **Not a bare string on the account.** Two spellings of one group would render as two
  sections, and there would be no way to rename a group without an `UPDATE` sweep.
- **Ordered.** Sections render in `sort_order`, so which group is looked at first is the
  operator's decision, not the alphabet's. Names tie-break equal orders — every category
  added after the seeded five takes the default of 100, and without the tie-break they would
  shuffle between page loads.

The five names from the ask are seeded by the migration, so the dropdown is usable on first
load rather than starting empty. They are seeded **verbatim** — including "FX Pages", which
is ambiguous enough that it was never going to survive contact — which is exactly why rename
shipped in the first version rather than being deferred. Renaming is one `UPDATE` against a
stable id; no account changes section.

### 14c. One category per account, deliberately

`categoryId`, not `categoryIds`. Sections carry their own totals, and an account filed under
two sections would have its engagement counted in both — the section totals would no longer
sum to the campaign total, and the "share of engagement" column would add up to more than
100%. A page that is genuinely both a vlogger and a reviewer gets filed where the operator
would look for it.

That is a real limitation, recorded here rather than smoothed over. Multi-tag grouping is
possible later, but it costs the additive property, and the additive property is what makes
the by-category table trustworthy.

### 14d. Uncategorised is a real state, never a guess

A page discovered by a subscription arrives unfiled, and nothing tries to infer what it is
from its caption or its Scoutline record. Unfiled accounts render in an **Uncategorised**
section that always sorts last, whatever `sort_order` the real categories carry — it is a
to-do list, not a peer of the others.

Two fallbacks land there too, both chosen so an account can never vanish off the screen:

- A `category_id` pointing at a category deleted between two reads.
- Any account whose category isn't in the list the page loaded.

Losing an account from the grid would read as "its posts stopped being tracked", which is a
worse failure than showing it as unfiled.

Deleting a category is safe by construction: the FK is `ON DELETE SET NULL`, so its accounts
fall back to Uncategorised. Nothing is deleted with it — no account, no post, no history —
which is why the delete button doesn't ask for confirmation.

### 14e. The filter has to go through the post predicate

The trap this feature walked toward: the category lives on the account, so the natural
implementation narrows the account list. Do only that, and `filteredPosts` — which the KPI
row and the whole "All posts" table are built from — silently ignores the category filter,
and the header and body of the page describe different sets of posts.

So the view builds an `accountId -> categoryId` map and tests it inside `matches(post)`,
alongside the platform and search filters. All four surfaces — KPIs, grid, all-posts table,
account totals — filter identically, and every section total is `aggregate()`d from the
filtered posts rather than read from a server-side rollup.

### 14f. Query cost: one more query, constant

The category list is one `findMany` for the whole screen, regardless of account count —
`getCampaignTracking` is now seven queries, still flat in the number of posts and accounts.
Pinned by `trackedPostsQueryCount.test.ts`, whose fixture files half its accounts and leaves
the rest unfiled so both paths are exercised by the count test.

The grouping itself is pure and lives in `src/lib/tracking/categories.ts`, tested directly —
including the property that matters most for the totals: every account is placed exactly
once, never dropped and never duplicated.

### 14g. Where it appears

- **Grid by account** — a category band above each group, carrying that group's own account
  count, post count, engagement and plays.
- **By category** (new view) — one row per category: accounts, posts, likes, comments, plays,
  engagement, average per post, and share of campaign engagement.
- **Account totals** — a Category column with an inline picker, which is the screen the
  operator lands on after a page subscription creates ten accounts at once.
- **Filter bar** — a category dropdown, shown only when more than one category is in use,
  same rule as the platform dropdown.
- **Manage categories** — rename, delete, add.

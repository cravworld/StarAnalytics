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

**Status: Phase 1 built, not yet deployed.** Instagram and YouTube work end to end; Facebook
is stubbed and fails loudly (§4a). The migration has NOT been applied — it lands the moment a
PR's preview build goes green, which is also the moment the tables exist in production.

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
| Views / plays | ✅ **video/reel only**, paid tier — see §1a | ✅ (page actor) / ❌ (post-URL actor) | ✅ `viewCount` |
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

### 4a. Facebook actor — genuinely undecided, and a test decides it

Verified 2026-08-21. Neither option is clean, and there is no safe armchair pick:

| | `apify/facebook-posts-scraper` (official) | `scrapyspider/facebook-post-scraper` |
|---|---|---|
| Input | **Page URLs only** — no post URLs | Direct post URLs (`urls`) |
| Returns | likes, comments, shares, reaction breakdown, **views** | likes, comments, shares — **no views** |
| Cost per *tracked* post | see below — **not** the headline rate | ~$0.001 |
| Risk | Official, maintained | Community, 206 total users, no ratings |

**The cost row is the trap.** The official actor bills ~$0.005–0.008 per *scraped* post, and
it can only be pointed at a page. To refresh one tracked post you scrape that influencer's
whole recent feed. Track 3 posts from an account whose `resultsLimit` is 50 and each refresh
costs ~$0.25–0.40, not ~$0.02 — and §6 wants that daily. Per tracked post that's roughly
20–50× the community actor, not 5×.

**The feasibility problem is worse than the cost problem.** A page scraper walks *recent*
posts. A tracked post that ages out of the scrape window simply stops appearing in the
results — and a re-scan that returns nothing is indistinguishable, to §6's taper logic, from
a post whose engagement has flattened. The feature would quietly stop measuring old posts
while reporting that they had settled.

So the decision rests on one empirical question, not on maintenance quality:

> At a sane `resultsLimit`, can `apify/facebook-posts-scraper` still see a post that is
> 30+ days old on a normally-active influencer page?

**Test before committing to either.** Take 3–5 real Facebook campaign URLs — deliberately
including at least one 30+ days old — and run both actors against them. If the official
actor can't reach the old post, page-scraping is disqualified for *tracking* regardless of
how well maintained it is, and the real choice becomes community-actor-versus-no-Facebook —
at which point the 206-user actor's risk has to be weighed on its own terms (pin the build,
treat its output as untrusted, fail loudly rather than writing zeros).

**Until that test runs, Facebook ingest is stubbed and throws an explicit "no Facebook actor
selected" error.** It does not return empty metrics. A tracked Facebook post that silently
reports zero engagement is worse than one that refuses to be added, because zero is
indistinguishable from a real result and would drag every campaign total down with it.
`TrackPlatform` carries `facebook` from day one so enabling it later is a provider change,
not a migration.

Note this is a different question from Scoutline's. Scoutline runs
`apify/facebook-pages-scraper` deliberately page-only, because it scores *accounts*. Tracking
scores *posts*, so the same publisher's page-level approach doesn't transfer.

Whichever wins, it lands behind the provider seam, so swapping later is a one-file change.

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

- **Facebook is not covered.** Stubbed, fails loudly (§4a). Needs 3–5 real URLs including
  one 30+ days old to settle the actor choice.
- **No re-scan cron yet** (§6). Metrics move only when someone presses Refresh, so velocity
  stays blank until a post is scanned twice.
- **No bulk upload yet** (Phase 3). The ingest function already takes an array and the form
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

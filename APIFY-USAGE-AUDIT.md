# Apify usage audit — 2026-08-07

Complete sweep of every path in the project that can spend Apify credit, done in
preparation for topping the account back up. Ordered by how much money the finding
can burn, not by how easy it is to fix.

## Ground truth (verified against the live Apify API, not assumed)

| Fact | Value | How it was checked |
| --- | --- | --- |
| Plan | STARTER, `maxMonthlyUsageUsd` = **$29** | `GET /v2/users/me/limits` |
| Current cycle usage | **$29.24 / $29** — cap already exceeded | same |
| Cycle window | 2026-07-31 → 2026-08-30 | same |
| Active Apify jobs right now | 0 (no orphaned runs currently billing) | `current.activeActorJobCount` |
| `apify/instagram-comment-scraper` pricing | PAY_PER_EVENT, **$0.0023 per comment** at our tier | `GET /v2/acts/...` `pricingInfos` |
| `apify/instagram-hashtag-scraper` pricing | PAY_PER_EVENT, **$0.0023 per result** | same |
| `apify/instagram-post-scraper` pricing | PAY_PER_EVENT, **$0.0015/post + $0.0008/post-details** | same |
| `apify/instagram-profile-scraper` pricing | PAY_PER_EVENT, **$0.0023 per profile** | same |
| **`resultsLimit` on the comment scraper is PER URL, not per run** | confirmed | actor build input schema: *"If set to 5, you will get 5 comments per URL. If you add 2 URLs, you will extract 10 results altogether."* |
| Default actor run timeout when we don't pass one | **30,000 s (8.3 h)** for comment + profile scrapers, 20,000 s for post, 10,000 s for hashtag | `defaultRunOptions.timeoutSecs` |
| `POST /v2/acts/{id}/runs` supports `maxTotalChargeUsd` and `timeout` | yes — `maxTotalChargeUsd` "caps the total amount charged for all pricing models" | Apify API reference |

The `resultsLimit` semantics and the 8.3-hour default run timeout are the two facts
that make findings **A** and **B** below far more expensive than the code comments
assume. The in-repo comment at `src/lib/data/sentiment.ts:26-31` ("one post with 225
stored comments, over the 200/run cap") was already evidence of per-URL semantics.

---

---

## Findings at a glance

Letters are stable identifiers (code comments reference them); the table is the cost ranking.

| Rank | ID | Finding | Status |
| --- | --- | --- | --- |
| 1 | **A** | Comment-scrape fan-out unbounded — one hourly tick could spend ~$138 | fixed |
| 2 | **B** | Abandoned runs keep billing for up to 8.3 h; every caller abandons them | fixed |
| 3 | **K** | Post scraper billing the paid `detailedData` tier for fields the code discards (~53% surcharge) | fixed |
| 4 | **C** | Posts that can never yield comments re-scraped every 24 h, forever | fixed |
| 5 | **D** | Exact-string comment attribution can silently discard a whole paid run | fixed |
| 6 | **E** | Hitting the cap mid-run does not open the circuit breaker | fixed |
| 7 | **G** | Agency batch: no dedupe, no idempotency, no result cap | fixed |
| 8 | **F** | Quota short-circuit covered only the hashtag loop | fixed |
| 9 | **L** | Profile scraper's paid `includeAboutSection` add-on left on the actor default | fixed |
| 10 | **H** | Two Apify entry points bypass the `DATA_MODE_APIFY` mock/live seam | documented, see below |
| — | **I** | Hourly hashtag polling costs ~$248/month per hashtag on a $29 plan | **operator decision** |
| — | **J** | Smaller items | partly fixed |

---

## A. Comment-scrape fan-out is unbounded — the single biggest exposure

**Where:** `src/lib/providers/apify-public-content.ts:181-213` (`scrapeCommentsForPosts`)

Every post handed in goes into one `directUrls` array with `resultsLimit: 200`. Because
`resultsLimit` is **per URL**, the run's cost is `posts × 200 × $0.0023`.

Callers and their worst case per single invocation:

| Caller | Posts per call | Worst-case comments | Worst-case cost |
| --- | --- | --- | --- |
| `api/cron/backfill-sentiment` (`CHUNK_SIZE = 300`, hourly) | 300 | 60,000 | **~$138** |
| `runAgencyBatchJob` (every post in the upload) | unbounded | unbounded | unbounded |
| `api/cron/poll-hashtags` (`campaignPostIds`, hourly) | unbounded | unbounded | unbounded |

One hourly `backfill-sentiment` tick can therefore spend ~4.7× the entire monthly plan
budget. Nothing in the code caps this: not the actor input, not the run options, not the
caller. The `$29` account cap is the only backstop, and it only stops the *next* run —
never the one in flight.

**Why it has not fired yet:** the account has been at its cap since 2026-07-31, so nothing
has actually run. The moment credits are added this is the first thing that executes.

## B. Abandoned runs keep billing, and every caller abandons them

**Where:** `src/lib/apify/client.ts:61-72` (`waitForRun`), plus every `maxDuration` export

`waitForRun` gives up after 20 minutes by throwing — it never calls Apify's abort
endpoint. And because `runActor` passes no `timeout`, the run keeps going on Apify's own
default, which is **8.3 hours** for the comment and profile scrapers. An abandoned
comment run keeps writing (and charging for) dataset items the whole time.

Worse, no caller can even reach that 20-minute wait, because every one of them is killed
by Vercel first:

| Caller | `maxDuration` | `waitForRun` ceiling | Gap |
| --- | --- | --- | --- |
| `campaigns/agency/page.tsx:12` (agency batch) | **300 s** | 1200 s | function dies at 5 min, run bills for up to 8 h |
| `campaigns/new/page.tsx:7` (auto-track on create) | **300 s** | 1200 s | same |
| `campaigns/hashtag/page.tsx:9` (Track button) | **300 s** | 1200 s | same |
| `api/cron/poll-hashtags/route.ts:32` | **800 s** | 1200 s | same |
| `api/cron/backfill-sentiment/route.ts:28` | 1800 s | 1200 s | ok |
| `api/cron/backfill-comment-sentiment/route.ts:31` | 1800 s | n/a (no Apify) | ok |

Consequences of the kill, all of which cost money:
1. The Apify run keeps billing with nobody reading its dataset — **paid for, never stored**.
2. The `scrape_runs` row stays `"running"` forever (the `catch`/`finally` never executes).
3. The `comment-scrape-pipeline` cron lock stays held for its full 21-minute TTL, so the
   next tick skips its comment scrape entirely.
4. The next tick re-scrapes the same hashtag/posts from scratch — **paying twice**.

## C. Posts that can never yield comments are re-scraped forever

**Where:** `src/lib/data/sentiment.ts:106`

```ts
const needComments = posts.filter((p) => p.postComments.length === 0 && p.externalUrl && p.comments !== 0);
```

There is no record of a scrape having been *attempted*. A post that is private, deleted,
has comments turned off, or whose comments simply failed to attribute (see **D**) stores
zero rows, so it re-qualifies on every staleness cycle — every 24 hours, forever, at full
price. `trackHashtag` returns a campaign's *entire* post history on every poll
(`src/lib/data/campaigns.ts:643-655`), so the whole back-catalogue re-enters this filter
each cycle rather than just new posts.

Note the `prune-raw-payloads` cron is **not** a contributor here: it nulls
`post_comments.text` but keeps the row (`api/cron/prune-raw-payloads/route.ts:75-78`), so
pruned posts still fail the `length === 0` test. That one is correct.

## D. Comment attribution is exact-string and silently drops whole runs

**Where:** `src/lib/providers/apify-public-content.ts:196-200`

```ts
const postUrl = typeof item.postUrl === "string" ? item.postUrl : null;
const postId = postUrl ? urlToPostId.get(postUrl) : undefined;
if (!postId) continue;
```

`postUrl` must echo the input byte-for-byte. Any normalisation by the actor — trailing
slash, `/reels/` → `/reel/`, a stripped `?igsh=` query param, `www.` added or removed —
drops **100 % of that run's items**: full cost, nothing stored. And because nothing is
stored, finding **C** then re-scrapes the same posts next cycle, at full price, forever.

The input URLs come from `Post.externalUrl`, which is whatever the previous actor put in
its `url`/`inputUrl` field (`src/lib/providers/apify-normalize.ts:52`) — so for agency
posts the shape ultimately traces back to a user-supplied spreadsheet.

## E. Hitting the cap *mid-run* does not open the circuit breaker

**Where:** `src/lib/providers/apify-public-content.ts:141-147`, `src/lib/apify/quotaBreaker.ts:32-34`

The breaker recognises the quota only from Apify's `403 platform-feature-disabled` on
*start*. If the cap is reached after `runActor` has already returned, the run ends
`FAILED`/`ABORTED` and `trackedRun` writes the generic message:

```ts
error: `Apify run ended with status ${finished.status}`
```

That string contains no `platform-feature-disabled` marker, so `isApifyQuotaError` returns
false, the circuit stays closed, and the rest of the tick keeps starting runs that die on
arrival. This is precisely the state the account is in right now ($29.24 of $29), and it
is the state it will re-enter the moment the new credits run out.

## F. Quota short-circuiting covers only the hashtag loop

**Where:** `src/app/api/cron/poll-hashtags/route.ts:83-98` vs `128-133`

The `quotaExhausted` flag correctly abandons the remaining hashtags. But the two calls
that run *after* the loop ignore it entirely:

- `refreshStaleCompetitors()` (`src/lib/data/compare.ts:112-125`) — one attempt per stale competitor
- `refreshStaleFanPages()` (`src/lib/data/fanpages.ts:305-318`) — one attempt per stale YouTube channel

Same gap in `runAgencyBatchJob` (`src/lib/data/agency.ts:118-121`): the batch loop keeps
issuing `scrapeByUrls` calls after the first quota rejection. The breaker inside
`trackedRun` does stop the actual Apify call, so this costs a database round-trip rather
than credit — but it also means each of these paths keeps *retrying* on every tick with no
record, instead of failing fast.

## G. Agency batch: no dedupe, no idempotency, no result cap

**Where:** `src/lib/data/agency.ts:116-121`, `src/lib/providers/apify-public-content.ts:279-289`

1. **Duplicate URLs are billed twice.** `rows.map((r) => r.url)` goes straight into the
   actor with no de-duplication. A spreadsheet listing the same post under two agencies —
   or just a copy-paste error — pays for it twice.
2. **Re-uploading the same sheet re-scrapes everything** at full price. There is no
   freshness check, unlike `/compare`'s 12-hour `COMPETITOR_SCRAPE_TTL_HOURS`.
3. **`scrapeByUrls` passes no `resultsLimit`** at all, unlike `scrapeByHandle`'s 50. If a
   row ever slips through validation as a profile URL rather than a post URL, the post
   scraper walks the entire profile history on our tab.
4. **A double-clicked submit fires two independent `after()` jobs**, each doing the full
   scrape. `analyseAgencyPostsAction` has no in-flight guard; the client-side `disabled`
   attribute is the only thing stopping it.

## H. Two Apify entry points bypass the mock/live seam

**Where:** `src/lib/data/sentiment.ts:7`, `src/lib/data/fanpages.ts:2`

```ts
import { scrapeCommentsForPosts } from "@/lib/providers/apify-public-content";
import { fetchProfileSnapshot, backfillFanPageLink } from "@/lib/providers/apify-public-content";
```

Both import the live Apify module directly instead of going through
`getPublicContentProvider()`, so **`DATA_MODE_APIFY=mock` does not stop comment scraping or
Instagram fan-page profile scraping.** `src/lib/apify/client.ts:1-3` states the rule these
two violate. Setting the mode to `mock` as a cost-control measure would not work today.

The e2e suite is safe from this by luck rather than design — `playwright.config.ts:35-40`
pins the mock modes, and neither of those two paths is exercised by a spec.

## I. Steady-state burn rate, for sizing the top-up

Per hourly `poll-hashtags` tick, per live hashtag:

- hashtag scrape: `resultsLimit: 150` × $0.0023 = **$0.345**
- 24 ticks/day = **$8.28 per hashtag per day** = **~$248/month for one tracked hashtag**

That is 8.5× the $29 plan on hashtag scraping alone, before a single comment is scraped.
The hourly cadence in `vercel.json` is not affordable on the current plan — this is a
configuration decision that needs making, not a bug.

(Note: `src/app/api/cron/poll-hashtags/route.ts:11` and `:46` describe the schedule as
`*/15` and `*/5`; `vercel.json` actually says `0 * * * *`. The comments are stale.)

## J. Smaller items

- **`waitForRun` polls every 3 s** (`client.ts:63`). Free, but 400 status calls per 20-minute
  wait is needless API load.
- **`getDatasetItems` fetches the whole dataset with no pagination** (`client.ts:45-51`). A
  60,000-comment dataset is a single unbounded JSON response into a serverless function's
  memory.
- **`scrapeByHashtag` runs even for a hashtag with no live campaign** when reached through
  `trackHashtagAction` (the Track button). Only the cron path filters to live campaigns
  (`poll-hashtags/route.ts:64-71`). That is arguably intended — a human clicked it — but it
  is the one way a non-campaign tag enters `hashtag_snapshots` and starts being polled.
- **No retry/backoff anywhere**, which is the right call for a metered API — worth keeping.
- **`vercel.json` runs `backfill-comment-sentiment` every minute.** Confirmed Claude-only,
  no Apify path — it operates on already-stored `post_comments` rows.

## K. Paying a premium data tier for fields the code deliberately throws away

**Where:** `src/lib/providers/apify-public-content.ts` (`scrapeByHandle`, `scrapeByUrls`)

`apify/instagram-post-scraper` has a `dataDetailLevel` input that **defaults to
`"detailedData"`** — the actor's own schema says "Detailed data are paid extra", and its
pricing confirms it as a second charge event:

- `post`: $0.0015 per post
- `post-details`: **$0.0008 per post, on top**

We never set the field, so every agency batch and every competitor/fan-page post scrape has
been billed at $0.0023 instead of $0.0015 — a **~53% surcharge**. Nothing consumes what it
buys: `apify-normalize.ts:42-44` maps `videoViewCount`/`videoPlayCount` to null on purpose,
and `toRawPost` reads only shortcode, url, owner, type, caption, timestamp, likesCount and
commentsCount — all of which are in the basic tier.

## L. Profile scraper's paid add-on left on the actor default

**Where:** `src/lib/providers/apify-public-content.ts` (`fetchProfileSnapshot`)

`includeAboutSection` bills as a separate `about-account` event at **$0.006 per profile** —
more than twice the $0.0023 profile charge itself. `normalizeProfileItem` reads only
`followersCount`, `fullName` and `postsCount`, none of which come from that section. The
schema defaults it to `false`, so this was not actively costing money, but leaving it
implicit meant an actor-side default change would start charging us silently.

---

## What was fixed

All in the commit accompanying this document.

**Hard spend limits, enforced by Apify rather than by us remembering to check**
- `runActor` now sends `maxTotalChargeUsd` on every run, derived from the run's expected
  item count and clamped to `DEFAULT_MAX_CHARGE_USD` ($5, `APIFY_MAX_CHARGE_USD_PER_RUN`).
  A run that goes wrong costs the cap and stops — it can no longer cost $138.
- `runActor` also sends an explicit `timeout`, so no run can inherit the actor's 8.3-hour
  default and outlive the function that started it.

**Nothing gets abandoned while still billing**
- `waitForRun` calls Apify's abort endpoint before throwing.
- Wait budgets now sit *below* every caller's function ceiling: 5 min default, 3 min for
  comment runs (`APIFY_COMMENT_RUN_WAIT_MS`). The agency, hashtag-search and new-campaign
  pages went from `maxDuration = 300` to `800`, since at 300 s they were structurally
  unable to finish their own `after()` work.

**Bounded fan-out** (`A`)
- `scrapeCommentsForPosts` caps at 10 posts per run (`APIFY_COMMENT_POSTS_PER_RUN`) and 20
  per invocation (`APIFY_COMMENT_POSTS_PER_INVOCATION`). Worst case per invocation drops
  from ~$138 to ~$9.20, and the backlog still drains across ticks.

**One attempt per post, ever** (`C`)
- New `posts.comments_scraped_at` column (migration
  `20260807120000_add_post_comments_scraped_at`), written per batch as soon as a run
  completes, and checked by `sentiment.ts`'s `needComments` filter. A batch that *throws*
  is never marked, so genuinely transient failures still retry.

**Attribution that survives URL-shape drift** (`D`)
- `postUrlKey` (in `apify-normalize.ts`, unit-tested) keys on the Instagram shortcode
  instead of an exact string match, with an `inputUrl` fallback and single-URL-batch
  disambiguation. Unattributed items are now logged loudly as paid-for-and-discarded.

**Cap detection that works mid-run** (`E`, `F`)
- `isAccountBudgetExhausted()` reads `GET /v2/users/me/limits` (unmetered, 60 s cached) and
  refuses to start a run with less than `APIFY_MONTHLY_RESERVE_USD` ($1) of headroom.
- `trackedRun` consults it when a run ends non-`SUCCEEDED` and stamps the quota marker onto
  the `scrape_runs` error, which is what opens the existing circuit breaker.
- Shared `isApifyQuotaFailure()` now short-circuits the competitor loop, the fan-page loop
  and the post-loop refreshes in `poll-hashtags`, not just the hashtag loop.
- `getPipelineHealth` consults the budget directly — necessary, because the preflight
  prevents the rejections the banner used to infer the outage from.

**Cheaper per item** (`K`, `L`)
- `dataDetailLevel: "basicData"` and `includeAboutSection: false` pinned explicitly.

**Agency batch** (`G`)
- URLs de-duplicated by shortcode before scraping (so `/p/` vs `/reel/` vs a trailing slash
  no longer buys the same post twice), and `scrapeByUrls` now sends `resultsLimit: 1`.

**Smaller** (`J`)
- `getDatasetItems` bounded by an explicit `limit` (`APIFY_DATASET_ITEM_LIMIT`, 10,000).
- `waitForRun` polls every 5 s rather than 3 s.
- The comment-scrape cron lock TTL dropped from 21 min to 17 min, matching the real
  worst-case duration instead of a wait nobody could reach.
- Stale schedule comments in `poll-hashtags` corrected (`*/15`, `*/5` → the deployed `0 * * * *`).

### Left deliberately unchanged

- **H (seam bypass).** `sentiment.ts` and `fanpages.ts` still import the live Apify module
  directly. Routing them through `getPublicContentProvider()` means widening the
  `PublicContentProvider` interface with `scrapeComments`/`fetchProfile` and implementing
  both on all three mock providers — a real refactor with its own risk, and not a spend leak
  now that spend is capped at the run level. Worth doing, but not in a change whose job is
  to make the top-up safe. **Until then: `DATA_MODE_APIFY=mock` is not a kill switch.** The
  kill switch is unsetting `APIFY_TOKEN`, or setting `APIFY_MAX_CHARGE_USD_PER_RUN` very low.
- **I (polling cadence).** Genuinely a budget decision, not a bug. See below.

---

## Before turning the credits back on

1. **The migration must land before the code does.** `posts.comments_scraped_at` is additive
   and nullable, but the code *reads* it — `classifyPostsForSentiment` selects every scalar
   column, so on a database without it every classification call throws. That failure is
   swallowed by `queueSentimentClassification`, which means **poll-hashtags would still pay
   for the hashtag scrape and then silently classify nothing** — precisely the spend-with-no-
   benefit failure this whole audit is about. `prisma generate` runs locally, so the build
   would pass and the deploy would succeed; it fails only at runtime.

   The build script is therefore now `prisma generate && prisma migrate deploy && next build`.
   **Watch the first deploy after this change.** If `_prisma_migrations` has drifted out of
   sync with the 9 pre-existing migration folders (i.e. anything was ever applied to this
   database out of band), `migrate deploy` will fail the build rather than the runtime —
   noisy, but recoverable with `prisma migrate resolve --applied <name>`. That is the
   deliberate trade: a loud build failure beats a silent runtime one.
2. **Decide the polling cadence (finding I).** At the current `0 * * * *` and
   `resultsLimit: 150`, one tracked hashtag costs **~$248/month** against a $29 plan. Options,
   in order of how much they save:
   - drop `poll-hashtags` to every 6 h (`0 */6 * * *`) → ~$41/month per hashtag
   - and/or lower `APIFY_HASHTAG_RESULTS_LIMIT` from 150 to, say, 50 → ~$14/month per hashtag at 6 h
   - if the cadence changes, revisit `APIFY_QUOTA_COOLDOWN_MINUTES` (55) — it is tuned to
     give exactly one breaker probe per hourly tick.
3. **Sanity-check the first tick.** After credits land, watch `scrape_runs` for the first
   hour: `kind='hashtag'` rows should be `done` with `item_count` near the limit, and
   `kind='comment_scrape'` rows should appear in batches of ≤10 posts.

---

## Operational notes

### The comment-attribution failure mode is now silent in the other direction

Finding **D** used to fail as "retry forever, waste money". It now fails as "never retry,
lose the comments" — the right trade when the goal is protecting credit, but it means the
`console.error` in `scrapeCommentsForPosts` ("could not be attributed to a post — paid for
and discarded") is the **only** signal that Apify has changed its URL echo. Watch for it.

Recovery, once `postUrlKey` has been fixed to match the new shape, is to clear the marker so
the affected posts become eligible again:

```sql
-- Re-enable comment scraping for posts that were attempted but stored nothing.
UPDATE posts SET comments_scraped_at = NULL
WHERE comments_scraped_at IS NOT NULL
  AND comments_scraped_at > now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM post_comments pc WHERE pc.post_id = posts.id);
```

Scope the window before running it — every row this clears buys another paid scrape.

### Cost knobs, in the order worth turning them

| Env var | Default | Effect |
| --- | --- | --- |
| `APIFY_HASHTAG_RESULTS_LIMIT` | 150 | Biggest recurring cost. Halving it halves the poll bill. |
| cron schedule in `vercel.json` | `0 * * * *` | Same lever, larger. See finding I. |
| `COMMENTS_PER_POST_LIMIT` | 200 | Comment depth per post. |
| `APIFY_COMMENT_POSTS_PER_INVOCATION` | 20 | Rate the comment backlog drains at, not its total. |
| `APIFY_MAX_CHARGE_USD_PER_RUN` | 6 | Runaway guard. Lowering below $5.72 starts clamping full comment batches — see the note in `apify-public-content.ts` on why that loses data. |
| `APIFY_MONTHLY_RESERVE_USD` | 1 | Headroom left unspent so the plan cap is never actually reached. |


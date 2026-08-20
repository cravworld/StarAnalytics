# StarAnalytics

A Next.js dashboard for Malayalam film/celebrity promotion: it tracks social performance
across a self account, competitors, fan pages and third-party campaign agencies, scores
bulk influencer/talent lists, and watches theatre-level booking demand — engagement,
sentiment, campaign scorecards and demand pressure in one place.

Five surfaces, each with its own data pipeline and its own verification status (see
**Project status** — don't assume a feature listed here is live against real data):

| Surface | Routes | What it does |
|---|---|---|
| **Own-account analytics** | `/`, `/content`, `/audience` | Dashboard, post performance, audience mix. Still on mock `InstagramInsights` pending Meta App Review |
| **Campaigns** | `/campaigns/*` | Own campaigns, hashtag search, keyword trends, comment sentiment, campaign comparison, agency scorecards, media-kit export |
| **Tracking** | `/compare`, `/fan-pages` | Competitor and fan-page tracking — Instagram **and** YouTube |
| **Scoutline** | `/scout` | Bulk talent scan: upload a PDF/Excel list of Instagram/Facebook links, get a ranked "Buzz Factor" leaderboard |
| **Theater Campaign Intelligence** | `/theater-campaigns` | BookMyShow ordinal demand pressure per theatre. **Mock-only today** — see `THEATER-CAMPAIGN-INTELLIGENCE.md` |

## Stack

- Next.js 16.2.10 (App Router) + React 19.2.4
- NextAuth (Auth.js v5) with Google OAuth, JWT sessions, email-domain/allowlist gating
- Prisma 6 + Postgres (Supabase) — 31 models, 21 migrations
- Chart.js / react-chartjs-2, plus a hand-rolled "notebook" design-token system
- `unpdf` (PDF parsing) and `xlsx` from the SheetJS CDN (upload ingestion, Excel export)
- Apify (Instagram/Facebook/BookMyShow scraping) + YouTube Data API v3 + Claude/OpenAI/Gemini
  (sentiment) + Resend (alert emails)
- Playwright (e2e) + Vitest (unit)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run db:migrate           # once DATABASE_URL points at a real Postgres instance
npm run dev
```

Everything runs with no third-party *API* credentials at all: every provider defaults to
`mock` (see **Data & providers**), so a fresh checkout renders the whole app on seeded data.
A Postgres instance is still required — that's what `DATABASE_URL` and the migrate step
above are for.

### Environment variables

See `.env.example` for the full annotated list. Highlights:

- `DATABASE_URL` / `DIRECT_URL` — Supabase Postgres. Pooled (port 6543) for runtime
  queries, direct (port 5432) for `prisma migrate`.
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google
  OAuth login (`src/auth.ts`).
- `ALLOWED_EMAIL_DOMAIN` / `ALLOWED_EMAILS` — fail-closed allowlist checked in the
  `signIn` callback (`src/lib/auth-allowlist.ts`); at least one must be set outside of
  local dev.
- `CRON_SECRET` — bearer token every `/api/cron/*` route requires. Each route fails closed
  (500) when it's unset.
- `DATA_MODE_INSTAGRAM` / `DATA_MODE_APIFY` / `DATA_MODE_SENTIMENT` / `DATA_MODE_NOTIFIER` /
  `DATA_MODE_YOUTUBE` / `DATA_MODE_BOOKMYSHOW` — per-provider `mock` | `live` switches
  (see Data & providers below).
- `COMMENT_SCRAPE` — global kill switch for *fetching new comments*. Off unless set to
  exactly `"on"` (`"true"`/`"1"`/`"yes"` all mean off, deliberately). See **The comment
  pipeline** below, because "off" does not mean sentiment stopped.
- `SENTIMENT_CLASSIFY` — separate kill switch for *classification itself*, same exact-`"on"`
  rule. Currently off in production (all three providers out of credit). Independent of
  `DATA_MODE_SENTIMENT`, and not interchangeable with it — see **The comment pipeline**.
- `APIFY_TOKEN`, `APIFY_ACTOR_HASHTAG`, `APIFY_ACTOR_PROFILE`, `APIFY_ACTOR_POST`,
  `APIFY_ACTOR_COMMENTS`, `APIFY_ACTOR_SCOUT`, `APIFY_ACTOR_SCOUT_FACEBOOK`,
  `APIFY_ACTOR_BOOKMYSHOW` — Apify actor wiring, plus a set of spend guards
  (`APIFY_MAX_CHARGE_USD_PER_RUN`, `APIFY_MONTHLY_RESERVE_USD`, `APIFY_QUOTA_COOLDOWN_MINUTES`,
  the various `*_LIMIT`s). Read `APIFY-USAGE-AUDIT.md` before changing any of them — most
  exist because of a specific, measured cost leak.
- `YOUTUBE_API_KEY` — official Data API v3 key (self-service, no app-review process:
  console.cloud.google.com → enable "YouTube Data API v3" → Credentials → API key) for
  live YouTube competitor/fan-channel tracking. Deliberately avoids `search.list` (100 of
  the 10,000-unit daily quota per call, ~100 calls/day cap) — uses `channels.list` /
  `playlistItems.list` / `videos.list` instead (~1 unit each).
- `ANTHROPIC_API_KEY`, `ANTHROPIC_SENTIMENT_MODEL` (defaults to `claude-sonnet-5`) —
  Claude sentiment classification (direct `fetch` call, no SDK).
  `OPENAI_API_KEY`/`OPENAI_SENTIMENT_MODEL` and `GEMINI_API_KEY`/`GEMINI_SENTIMENT_MODEL`
  back a same-shape fallback chain (Claude → OpenAI → Gemini) that a batch moves down
  whenever the current provider's call fails for any reason — added after a real Anthropic
  credit exhaustion stalled classification. All three keys are required for the fallback to
  actually cover a Claude outage; an unset key just makes that leg throw immediately and the
  next provider gets tried. **Note the privacy consequence**: the fallback sends third-party
  comment text to OpenAI and Google too, not only Anthropic — see `DATA-PRIVACY.md`.
- `SENTIMENT_BATCH_CONCURRENCY` — how many classification batches run at once (default 5).
- `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` — velocity/alert emails and the
  weekly digest (direct `fetch` call, no SDK). `ALERT_EMAIL_FROM` can be Resend's sandbox
  address (`onboarding@resend.dev`, delivers only to the email your Resend account was
  signed up with) until a domain is verified for real recipients.
- `BOOKMYSHOW_*` — Theater Campaign Intelligence. Two independent switches:
  `DATA_MODE_BOOKMYSHOW` ("a real scan is wired up and works") and
  `BOOKMYSHOW_MONITORING_ENABLED` ("unattended scheduled scanning is allowed to run"). Both
  stay off by default on purpose. `BOOKMYSHOW_CAPTURE_SECRET` protects the two capture
  endpoints that sit outside NextAuth.
- `RAW_PAYLOAD_RETENTION_DAYS` / `COMMENT_RETENTION_DAYS` — data-minimization windows
  (default 90 each), enforced by the `prune-raw-payloads` cron. See `DATA-PRIVACY.md`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | `prisma generate` + `prisma migrate deploy` + `next build` |
| `npm run lint` | ESLint — **currently crashes**, see Known limitations |
| `npm run test:unit` | Vitest (26 files, 244 tests) |
| `npm run test:e2e` | Playwright (29 tests across 4 spec files, see `e2e/`) |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run db:migrate` | `prisma migrate dev` against `DATABASE_URL` |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:studio` | Prisma Studio |
| `npm run data-rights:lookup -- <handle>` | Read-only DPDP access/deletion-request lookup — see `DATA-PRIVACY.md` |
| `npm run audit:raw-payload` | Reports which fields actually appear in raw scrape payloads, without printing values — informs retention decisions |

Not wired into `package.json`, run with `node --env-file=.env.local scripts/<file>`:
`bms-capture.mjs` (local-browser BookMyShow capture, with `install-bms-capture-task.ps1` to
schedule it on Windows), `check-tokens.mjs`, `eval-sentiment-model.mjs` (sentiment model
eval against the fixture set), `purge-e2e-agencies.mjs` (removes stray e2e agency rows).

## Architecture

23 pages and 23 API routes under `src/app`, 52 components, 26 unit-test files.

### Routes (`src/app`)

`(app)/` is the authenticated shell; `login/` is the Google sign-in page.

| Route | Screen |
|---|---|
| `/` | Dashboard |
| `/content` | Content performance |
| `/audience` | Audience breakdown |
| `/compare` | Competitor tracking (Instagram + YouTube) |
| `/campaigns` | Own campaigns list |
| `/campaigns/new` | Create campaign (reachable, but not offered in nav — it's a form, not a view) |
| `/campaigns/[id]` | Campaign detail |
| `/campaigns/[id]/media-kit` | Print-to-PDF one-pager for a campaign |
| `/campaigns/hashtag` | Hashtag search/tracking (Instagram only) |
| `/campaigns/keywords` | Keyword trends |
| `/campaigns/comments` | Per-comment sentiment |
| `/campaigns/compare-own` | Campaign-vs-campaign comparison, incl. day-N alignment |
| `/campaigns/agency` | Agency report: upload, scorecard, authenticity audit, posts table |
| `/fan-pages`, `/fan-pages/[id]` | Fan-page tracking and per-page detail |
| `/scout`, `/scout/[batchId]`, `/scout/compare` | Scoutline batches, leaderboard, batch comparison |
| `/theater-campaigns`, `/theater-campaigns/new`, `/theater-campaigns/[id]`, `/theater-campaigns/[id]/theaters/[theaterId]` | Theater Campaign Intelligence |

`src/lib/campaignRoutes.ts` is the single source of truth for the `/campaigns/*` sub-nav —
it exists because that list previously lived in three places and drifted twice, silently
misclassifying real sibling pages as campaign detail views.

API routes: `api/auth/[...nextauth]`, `api/agency-run/[id]/status` (agency scrape polling),
`api/scout/*` (upload, quick scan, start-runs, retry, rescore, archive, Excel export,
settings), `api/theater-campaigns/[id]/*` (scan, scan-status, capture-plan, ingest),
`api/dev/scrape-hashtag` (dev-only), and eight `api/cron/*` routes — of which seven are
actually scheduled (see below).

### Scheduled jobs

Every cron route requires a `CRON_SECRET` bearer token and fails closed without it; most
also take a `cronLock` so overlapping invocations can't duplicate paid work.

| Cron | Schedule (`vercel.json`) | What it does |
|---|---|---|
| `poll-hashtags` | `0 * * * *` (hourly) | Re-scrapes tracked hashtags into `hashtag_snapshots`; also drives fan-page linking, velocity alerts and `/compare` refresh |
| `backfill-comment-sentiment` | `* * * * *` (every minute) | Chunked per-comment classification of comments already stored |
| `poll-scout-runs` | `*/2 * * * *` | Polls in-flight Scoutline Apify runs and ingests their results |
| `scan-theater-campaigns` | `*/30 * * * *` | Ticks BookMyShow scans; each campaign scans only once its own `scanIntervalMinutes` (default 90) has elapsed |
| `snapshot-buzz` | `0 6 * * *` | One `CampaignBuzzSnapshot` per live campaign per day, so trend sparklines have no gaps |
| `prune-raw-payloads` | `0 7 * * *` | Data-minimization pruning (see `DATA-PRIVACY.md`) |
| `weekly-digest` | `0 9 * * 1` | Monday-morning consolidated digest email across every live campaign |

`api/cron/backfill-sentiment` exists as a route but is **switched off**: it was removed from
`vercel.json`'s `crons` array on 2026-08-17 for credit reasons and is still off, because it's
the one cron that pays Apify for a comment scrape (finding **A**). Re-enabling it needs both
the `vercel.json` entry restored *and* `COMMENT_SCRAPE=on` — the entry alone would run it to
no effect. `APIFY-USAGE-AUDIT.md`'s "Disabled cron jobs" section is the live record of that
decision; disabled entries are documented there rather than deleted, because Vercel rejects
unknown top-level keys in `vercel.json` and an earlier `_disabledCrons` key failed the
deployment at config validation.

### Data & providers (`src/lib`)

- `data/` — per-screen query/aggregation layer (`dashboard.ts`, `content.ts`, `audience.ts`,
  `compare.ts`, `campaigns.ts`, `agency.ts`, `fanpages.ts`, `scout.ts`, `theaterCampaigns.ts`,
  `sentiment.ts`, `commentSentiment.ts`, `keywords.ts`, `weeklyDigest.ts`,
  `pipelineHealth.ts`, and the various `*Alerts.ts`) that pages read from.
- `providers/` — swappable data sources behind small interfaces
  (`InstagramInsightsProvider`, `PublicContentProvider`, `SentimentProvider`,
  `NotifierProvider`), each with a `mock-*` and a live implementation. Which one is selected
  is controlled entirely by the `DATA_MODE_*` env vars via `providers/index.ts` — no code
  change needed to flip a provider live. `PublicContentProvider` has two live implementations
  behind a `Platform` (`instagram` | `youtube`) column on `Post`/`CompetitorAccount`/`FanPage`:
  `apify-public-content.ts` (Instagram, via Apify) and `youtube-public-content.ts` (YouTube,
  direct official Data API v3 fetch — no scraping needed). `platform-utils.ts` holds the
  shared handle-validation/provider-selection logic Compare and Fan Pages both need.
- `apify/client.ts` — thin Apify actor client. `apify/quotaBreaker.ts` — circuit breaker for
  Apify's monthly spend cap: once the account is over `maxMonthlyUsageUsd`, Apify rejects
  every start with a `platform-feature-disabled` 403, and without the breaker `poll-hashtags`
  fired one doomed scrape per hashtag every hour (measured in prod on 2026-08-07: 1,098
  failed runs against 76 successful ones all-time) while the app kept serving week-old
  campaign figures as current.
- `scoring/` — `scorePost.ts` / `cohort.ts` / `config.ts` (agency post scoring),
  `buzzScore.ts` (campaign buzz), `scoreInfluencer.ts` (Scoutline's Buzz Factor).
- `scout/` — Scoutline ingestion (`ingest.ts`) and Excel export (`export.ts`).
- `bookmyshow/` — URL building, normalization, demand modelling, scoring and validation for
  Theater Campaign Intelligence, with its own `providers/` mock/live seam.
- `upload/` — agency report upload/ingestion handling.
- `actions/` — server actions, every one behind `requireSession()`.

### Scoutline

Upload a PDF or Excel/CSV list of Instagram/Facebook links; the parser (`scout/ingest.ts`)
converges both formats on one deduped candidate list, with platform detected from the URL's
own domain rather than a separate column, so an existing Instagram-only sheet keeps working
unchanged. Each candidate is scanned via Apify
(`easy_scraper/instagram-profile-engagement-analytics`, `apify/facebook-pages-scraper` for
pages) and scored into a 0–100 **Buzz Factor**: a pure function over engagement (0.45),
reach (0.30), content mix (0.20) and consistency (0.05), with per-batch weight overrides in
the settings panel. Those weights and their reference constants were retuned on 2026-08-17
against the actual distribution of the first real 202-account batch, not guessed. A signal
that can't be measured for an account is excluded and the rest renormalized — never faked as
a neutral midpoint — and an account with neither measurable reach nor measurable engagement
is withheld from scoring rather than given a misleading number. Instagram and Facebook are
ranked in separate leaderboard sections, since their metrics aren't comparable. Batches
archive, filter, and export to Excel with real hyperlinks.

There is deliberately **no authenticity/bot-detection component** in the Buzz Factor: this
actor returns aggregate stats only, with no comment text to run the existing
`generic_comment_pattern` detector against.

### Theater Campaign Intelligence

Tracks how much of a film's slate BookMyShow still shows as on sale, per theatre, so campaign
spend can be pointed where nobody is booking. **It is not a ticket-sales tool.** BookMyShow
publishes no seat counts on any page this feature is permitted to read, so there is no
occupancy percentage and there cannot be one — anything phrased as "% full" would be
fabricated. What exists is a 4-level ordinal `availStatus` per show, of which only two levels
have confirmed meanings ("Not on sale" is *not* "sold out"). The useful signal is *movement*
over time, not any single reading, and aggregates describe the BookMyShow-listed subset, not
the market. Read `THEATER-CAMPAIGN-INTELLIGENCE.md` (how to run it) and
`BOOKMYSHOW-FEASIBILITY.md` (what was actually established, and how) before using any number
it produces.

### The comment pipeline

Three separate things, easy to conflate:

1. **Fetching new comments from Apify** is globally **off** (`COMMENT_SCRAPE !== "on"`).
   This is the metered, expensive half — see `APIFY-USAGE-AUDIT.md` finding **A**.
2. **The fan-page screens opt in explicitly** per call, which is the only reason their
   comment panels have anything to show while the global switch is off. The cron path
   deliberately does *not* opt in — an unattended hourly opt-in would turn a switched-off
   pipeline back on by the back door.
3. **Classifying** what's stored is a *third*, separately switched thing: `SENTIMENT_CLASSIFY`
   (added 2026-08-20), on only for the exact value `"on"`, same discipline as
   `COMMENT_SCRAPE`. It is currently **off in production** — all three providers (Claude,
   OpenAI, Gemini) are out of credit. Off means no AI call and no `Sentiment` row written;
   it does *not* mean mock labels. Note that `DATA_MODE_SENTIMENT=mock` is the wrong way to
   switch classification off: mock marks every post positive at 0.78 and writes it to the
   same table as real results, which is worse than no data. Anything skipped is picked up
   automatically on the first run after the flag flips back on; nothing is lost.
   `backfill-comment-sentiment` still ticks every minute, and logs what it left unclassified
   rather than going quiet.

Posts with no stored comments fall back to caption-only classification and log that they
did — "0 comments stored" and "comment scraping is switched off" look identical downstream,
and the difference matters: the first is a finding, the second is a config choice. The same
reasoning is why all three switches log rather than silently no-op.

### Design system

The UI runs on a design-token system (`src/app/globals.css`) re-skinned onto a "notebook"
visual language, with motion, a11y and responsive rules in the tokens rather than
per-component. `src/lib/palette.ts` owns *identity* colours (telling one agency, fan page or
campaign apart from another) as ten two-pressure "pencils"; `components/charts/theme.ts` owns
data colours; `globals.css` owns semantic ones. Palette lightness alternates across the set
on purpose, so near-neighbour hues stay distinguishable in a ten-row leaderboard, and every
pair is contrast-measured rather than eyeballed.

### Auth

`src/auth.ts` wires Google OAuth through Auth.js v5, gates sign-in on
`ALLOWED_EMAIL_DOMAIN`/`ALLOWED_EMAILS`, and best-effort upserts `users.role` into Postgres
on login (falls back to `role: "team"` if the database isn't reachable, so local dev works
without a live Supabase project). Every Server Action and non-cron API route goes through
`requireSession()` — Server Actions bypass page/layout rendering, so the `(app)` layout's
redirect never protected them (see Project status).

## Deploying auth

The deployed app lives at **`https://staranalytics.vercel.app`** (Vercel project
`star-analytics`). Steps to get Google sign-in working there:

1. **Google Cloud Console** (console.cloud.google.com) → create/select a project →
   **OAuth consent screen**: External, add your own account under "Test users" while
   unverified. → **Credentials → Create Credentials → OAuth client ID → Web
   application**. Authorized redirect URIs — add **both**:
   ```
   https://staranalytics.vercel.app/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```
   Copy the Client ID and Client Secret.
2. **Vercel** (Project Settings → Environment Variables, set for **Production**;
   `.env.local` already has the `localhost` equivalents for dev):
   ```
   NEXTAUTH_URL=https://staranalytics.vercel.app
   NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
   GOOGLE_CLIENT_ID=<from step 1>
   GOOGLE_CLIENT_SECRET=<from step 1>
   ALLOWED_EMAIL_DOMAIN=<your team's domain>   # or ALLOWED_EMAILS — at least one is required outside local dev, the signIn callback fails closed without it
   ```
   Auth.js v5 auto-trusts the host on Vercel deployments even without `NEXTAUTH_URL`
   set, so this isn't a hard blocker the way it was in `next-auth` v4 — but set it
   explicitly anyway, since it's what has to match the redirect URI above exactly.
3. If a custom domain is ever attached in place of `staranalytics.vercel.app`, both the
   Google Cloud Console redirect URI and `NEXTAUTH_URL` need updating together — a
   mismatch between the two is the most common way Google OAuth fails silently or
   bounces back to `/login`.

## Testing

- **Unit** — `npm run test:unit`: 244 tests across 26 files (243 passed, 1 skipped, run
  2026-08-20). Covers scoring, normalization, the BookMyShow pipeline, retention and
  validation rules, and the comment-scrape opt-in contract.
- **e2e** — `npm run test:e2e`: 29 tests across 4 spec files, driving the app in a real
  browser against seeded mock data, behind real auth (a session token minted the same way
  Auth.js's own `encode()` would produce one — nothing about the guard is disabled or
  stubbed, and negative tests prove it still bites). One of the four,
  `e2e/reference/prototype.spec.ts`, captures the *prototype* HTML rather than the app, to
  produce the comparison set. The harness mints its session from `AUTH_SECRET` or
  `NEXTAUTH_SECRET` (Auth.js v5 order — setting `NEXTAUTH_SECRET` alone is enough) and
  optionally `E2E_TEST_EMAIL`, which defaults to `e2e@staranalytics.test`. The redesign
  sign-off set covers 17
  route/state captures in `e2e/screens/`, for side-by-side human review against
  `e2e/reference/shots/`. They are deliberately not pixel-diffed — different DOM, fonts and
  scroll model would produce false failures that say nothing about fidelity. Both sets
  regenerate on every run, so they show up in `git diff` after any run even when nothing
  changed meaningfully.
- `e2e/PHASE0-VERIFICATION.md` is the original Phase 0 verification record: what that harness
  verified, what it deliberately didn't, and the fidelity gaps it found against the HTML
  prototype (`staranalytics_prototype.html`). It's a dated record, not a live description of
  today's suite.

Coverage gaps worth knowing — and two of them are decisions, not backlog:

- **`/campaigns/comments` is deliberately never screenshotted.** It renders third-party
  commenters' handles and full comment text — exactly the two columns `DATA-PRIVACY.md`
  treats as personal data and prunes after `COMMENT_RETENTION_DAYS`. A PNG committed to git
  would hold that data permanently and outside any prune, because git history isn't erasable
  the way a nulled column is. Capturing it would quietly defeat a retention policy the app
  actually implements. If a capture is ever wanted for design review, take it against a
  scratch database and keep it out of the repo.
- **`/scout/compare` is deliberately not captured** either: it renders an empty main region
  until batches are selected, and seeding scan batches would break the suite's read-only
  discipline.
- Genuinely not covered yet: `/theater-campaigns/*`, `/fan-pages/[id]`, `/scout/[batchId]`.

The agency
analysis flow is exercised exactly once, in `phase3-agency-verify.spec.ts`, with throwaway
`E2E Agency N` names and an `afterAll` cleanup — three stray agencies were still sitting in
production on 2026-08-07 because an earlier spec wrote realistic-looking rows to whatever
database the harness was pointed at.

## Project status

Phases 0–6 are merged to `main` (prototype parity, real providers, sentiment pipeline,
campaign/agency scoring, fan page alerts, hashtag search). Verification status differs by
surface — this is the honest version, and it is not "everything works":

- **Phase 7 (Graph API self-account dashboard) — written, never exercised.** There's a real
  `GraphInstagramInsightsProvider` (`src/lib/providers/graph-instagram-insights.ts`) wired
  behind `DATA_MODE_INSTAGRAM=live`, unit-tested against documented API response shapes, but
  never run against a live account: that needs Meta App Review (Business/Creator account
  conversion, a registered Meta app, approved `instagram_basic`/`instagram_manage_insights`).
  `isInstagramInsightsLive()` is the single source of truth for this, and screens showing
  that data render a "Pending Meta App Review" badge rather than presenting mock numbers as
  real. Two fields (`AccountInsights.profileVisits`, `Demographics.heatmap`) have no Graph
  API equivalent and are flagged inline for a product decision. Re-verify field names against
  a real response once a token exists.
- **YouTube (added 2026-07-24)** makes Compare and Fan Pages genuinely multi-platform.
  *Fan Pages is confirmed against the real YouTube API* — a real channel (`@mkbhd`) added
  through the actual UI, 25 real videos with real view counts, cleaned up after. *Compare is
  verified end-to-end through the real UI but only in mock mode* — a real DB row and platform
  badge, not a live Data API call. Deliberately **not** extended to YouTube: hashtag/campaign
  tracking (`scrapeByHashtag` throws an explicit "out of scope" error for YouTube rather than
  doing something wrong silently) and own-channel YouTube Analytics (impressions/demographics
  need a separate OAuth-based integration — deferred, same shape as Phase 7's gate).
- **Facebook is Scoutline-only, and pages only** (added 2026-08-18). It is not a tracking
  platform for Compare or Fan Pages.
- **Theater Campaign Intelligence is mock-only.** `DATA_MODE_BOOKMYSHOW` stays `mock` until
  an Apify browser actor has been *proven* to load a BookMyShow showtime page. As of
  2026-08-20 that is unresolved and looks unlikely: Apify headless and `curl` both get 403
  where a real browser on the same connection gets 200. Mock mode is fully functional — it
  replays the real Kerala measurements from 2026-08-20 — and the working collection path
  today is `scripts/bms-capture.mjs`, a real Chrome on an operator's machine POSTing to the
  ingest endpoint under `BOOKMYSHOW_CAPTURE_SECRET`, server-side capped at
  `BOOKMYSHOW_CAPTURE_MAX_PER_DAY`.
- **Naming debt accepted on purpose**: `igShortcode`/`igHandle` were kept rather than renamed
  to something platform-neutral, to avoid touching 9+ call sites across the ingestion
  pipeline on tables holding real production data. They now hold YouTube video ids/channel
  handles too — documented inline at each site, not a bug.
- **Security & DPDP audit (2026-07-28, two PRs)** found and fixed a real gap: every Server
  Action and the dev scrape route were directly POST-reachable regardless of auth state,
  because Server Actions bypass page/layout rendering entirely and the `(app)` layout's
  redirect never protected them. All now require a session via a shared `requireSession()`
  guard. Also patched in the same pass: `xlsx` (CDN 0.20.3 — npm's last published 0.18.5
  doesn't carry the prototype-pollution/ReDoS fixes), two critical `next-auth`/`@auth/core`
  CVEs in the Google OAuth flow, and security headers in `next.config.ts` (HSTS,
  `X-Frame-Options`, `X-Content-Type-Options`, a minimal `frame-ancestors` CSP — not a full
  `script-src` CSP, since the app embeds Google's OAuth UI).
- **Apify cost audit (2026-08-07, `APIFY-USAGE-AUDIT.md`, refreshed 2026-08-20)** — the
  account had already blown its $29/month STARTER cap. Nine findings fixed: unbounded comment
  fan-out (one hourly tick could spend ~$138), abandoned runs billing for up to 8.3h, a paid
  detail tier charged for fields the code discards, no circuit breaker on cap exhaustion,
  agency batches with no dedupe or result cap, and more. One remains an **operator decision**:
  hourly hashtag polling costs roughly $248/month per hashtag. That document is the reference
  for anything cost-related.

## Known limitations

- **`npm run lint` crashes and has not been fixed.** ESLint 9.39.5 dies with
  `TypeError: Converting circular structure to JSON` while validating the legacy config that
  `eslint-config-next` extends into. Reproduced 2026-08-20. Lint is therefore not part of any
  green-build claim here; `npm run test:unit` and `npm run test:e2e` are.
- **The comment scrape is switched off** (`COMMENT_SCRAPE`), by cost decision, and only the
  fan-page screens opt back in. See **The comment pipeline** above — classification of
  already-stored comments is unaffected.
- **Cron cadence is no longer once/day.** The project is on Vercel Pro now, so the old
  Hobby-plan cap (which had been silently failing every deploy with `deploy_failed`) no
  longer applies: seven crons are registered, several sub-daily. Note that
  `backfill-comment-sentiment` runs at `* * * * *` — a minute-level cron on a paid plan is a
  real, ongoing cost line, kept because comment classification is otherwise the pipeline's
  slowest link.
- **Fan-page alert emails are sandboxed.** With `ALERT_EMAIL_FROM` set to Resend's sandbox
  address, delivery only works to the single email your Resend account was signed up with.
  Verify a domain with Resend before relying on alerts reaching anyone else.
- **The Topbar date-range control is visibly disabled everywhere, on purpose, not
  unbuilt-and-forgotten.** `AccountInsights` has no date parameter today (mock/Phase 7 data
  is a single fixed snapshot); wiring the selector would mean fabricating per-range numbers,
  exactly what this project's "not evaluated, not fabricated" discipline exists to avoid. It
  gets an honest home once Phase 7's since/until-based provider is live. CSV export is
  similarly scoped rather than universal: wired for the Campaigns list, the Agency Report's
  posts table and Scoutline (real DB data), and disabled with a tooltip on
  Dashboard/Content/Audience, which are still on mock `InstagramInsights` pending Phase 7.
- **`UserRole` (`admin`/`team`/`agency_viewer`) is stored but deliberately unenforced** —
  every logged-in user gets full access, a documented product decision, not an oversight.
  There's also no schema link between `User` and `Agency`, so an `agency_viewer` couldn't be
  scoped to just their own agency's data even if role-checking were added — link that before
  onboarding the first external agency login, not after.
- **The campaign detail page's "Live" post stream polls rather than truly streams.**
  `src/components/campaigns/LiveStream.tsx`, rendered by `/campaigns/[id]` and nowhere else —
  earlier versions of this README attributed it to `/compare`, which has no live indicator at
  all (the `isInstagramInsightsLive()` call on that screen is the Meta App Review badge, an
  unrelated thing). It
  used Supabase Realtime, which turned out to be silently non-functional in production: RLS
  is enabled with zero policies, so the public `NEXT_PUBLIC_SUPABASE_ANON_KEY` can't read any
  row — it would connect and show "Live" but never actually receive an event. Granting the
  anon key read access would have fixed that while reintroducing a public, non-expiring
  credential with direct read access to Confidential campaign data. Replaced with 8-second
  authenticated polling through the same `requireSession()`-gated data layer as the rest of
  the app.
- **Two BookMyShow endpoints sit outside NextAuth by design.**
  `api/theater-campaigns/[id]/ingest` and `.../capture-plan` are reachable without a session,
  because the capture script is a scheduled process with no browser session. They are
  protected by `BOOKMYSHOW_CAPTURE_SECRET` instead and fail closed when it's unset.
- **Raw scrape payloads and comment text are minimized, not retained forever.** `posts.raw` /
  `post_comments.raw` store the complete Apify response but nothing reads them back
  (confirmed by grep — `npm run audit:raw-payload` reports what's actually in them without
  ever printing values); the `prune-raw-payloads` cron nulls `raw` past
  `RAW_PAYLOAD_RETENTION_DAYS` (default 90), and the same cron nulls
  `post_comments.text`/`author_handle` past `COMMENT_RETENTION_DAYS` (default 90) — comment
  text is a third party's data, read exactly once by the classifier and never again. Posts'
  own caption/engagement data and derived `sentiment` rows are **deliberately kept
  indefinitely** — that's the tracked account's own business data and the entire analytics
  product depends on it. See `DATA-PRIVACY.md`'s "Retention" section for the full reasoning.
- **DPDP legal basis is a working assumption, not a confirmed legal position, and formal
  counsel confirmation is deliberately not being pursued.** Everything scraped (posts,
  comments, competitor/fan accounts) relies on DPDP §3(c)(ii)'s public-data exclusion —
  reasonable, but never legally confirmed, by product decision rather than oversight. Nothing
  else in the app or in `DATA-PRIVACY.md` is blocked on this. See `DATA-PRIVACY.md` for the
  full posture, the rights-request lookup tool (`npm run data-rights:lookup -- <handle>`,
  read-only), and what else is flagged vs. actually built.

## Companion documents

| File | What it is |
|---|---|
| `DATA-PRIVACY.md` | Internal DPDP operating record: what's collected, legal basis, retention, cross-border processing, rights requests |
| `APIFY-USAGE-AUDIT.md` | Dated cost audit (2026-08-07, refreshed 2026-08-20) of every Apify-spending path. Read before touching spend controls |
| `THEATER-CAMPAIGN-INTELLIGENCE.md` | How to run theatre demand tracking, and what its numbers do and don't mean |
| `BOOKMYSHOW-FEASIBILITY.md` | The 2026-08-20 spike: what BookMyShow actually exposes, and how that was established |
| `e2e/PHASE0-VERIFICATION.md` | Dated Phase 0 browser-verification record |
| `AGENTS.md` / `CLAUDE.md` | This project pins a Next.js version whose APIs/conventions may differ from generic training data — read the relevant guide in `node_modules/next/dist/docs/` before relying on remembered Next.js behavior |

---
*Reconciled against the actual codebase on 2026-08-20, at commit `5f01c11`. The previous
version was written at `256aaa8` (2026-08-04) and 35 commits had landed since without it
being updated — Scoutline, Facebook support, Theater Campaign Intelligence, the notebook
re-skin, the media-kit/timeline/digest/keyword features, the comment-scrape kill switch and
the Apify cost audit were all missing or actively contradicted. The local checkout was found
2 commits behind `origin/main` and fast-forwarded before this pass, so this describes
`origin/main` rather than a stale snapshot. Every count and claim above was checked against
the tree: route/component counts by `find`, cron names and schedules against `vercel.json`,
the unit total against an actual `vitest run` (243 passed / 1 skipped), the e2e total against
`playwright test --list` (29 tests in 4 files — the suite was listed, not run, in this pass,
so no pass/fail claim is made for it), model defaults against
`src/lib/providers/claude-sentiment.ts`, env names against `.env.example` plus a grep of
`process.env` across `src/` and `scripts/`, and the e2e coverage-gap list against all four
spec files rather than inferred from the screenshot filenames.*

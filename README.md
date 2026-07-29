# StarAnalytics

A Next.js dashboard for tracking social performance across a self account, competitors,
fan pages, and third-party campaign agencies for Malayalam film/celebrity promotion —
engagement, sentiment, and campaign scorecards in one place. Started Instagram-only;
competitor and fan-page tracking are now Instagram **and** YouTube (see Project status).

## Stack

- Next.js 16 (App Router) + React 19
- NextAuth (Auth.js v5) with Google OAuth, JWT sessions, email-domain/allowlist gating
- Prisma + Postgres (Supabase)
- Chart.js / react-chartjs-2
- Apify (public Instagram scraping) + YouTube Data API v3 (public channel/video data) +
  Claude (sentiment classification) + Resend (fan-page alert emails)
- Playwright (e2e) + Vitest (unit)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run db:migrate           # once DATABASE_URL points at a real Postgres instance
npm run dev
```

### Environment variables

See `.env.example` for the full annotated list. Highlights:

- `DATABASE_URL` / `DIRECT_URL` — Supabase Postgres. Pooled (port 6543) for runtime
  queries, direct (port 5432) for `prisma migrate`.
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google
  OAuth login (`src/auth.ts`).
- `ALLOWED_EMAIL_DOMAIN` / `ALLOWED_EMAILS` — fail-closed allowlist checked in the
  `signIn` callback (`src/lib/auth-allowlist.ts`); at least one must be set outside of
  local dev.
- `DATA_MODE_INSTAGRAM` / `DATA_MODE_APIFY` / `DATA_MODE_SENTIMENT` / `DATA_MODE_NOTIFIER` /
  `DATA_MODE_YOUTUBE` — per-provider `mock` | `live` switches (see Providers below).
- `APIFY_TOKEN`, `APIFY_ACTOR_HASHTAG`, `APIFY_ACTOR_PROFILE`, `APIFY_ACTOR_POST`,
  `APIFY_ACTOR_COMMENTS` — Apify actor wiring for live scraping.
- `YOUTUBE_API_KEY` — official Data API v3 key (self-service, no app-review process:
  console.cloud.google.com → enable "YouTube Data API v3" → Credentials → API key) for
  live YouTube competitor/fan-channel tracking. Deliberately avoids `search.list` (100 of
  the 10,000-unit daily quota per call, ~100 calls/day cap) — uses `channels.list` /
  `playlistItems.list` / `videos.list` instead (~1 unit each).
- `ANTHROPIC_API_KEY`, `ANTHROPIC_SENTIMENT_MODEL` (defaults to `claude-opus-4-8`,
  bumped from Sonnet 2026-07-24 — better on code-mixed Malayalam/English/slang text and
  batch sizes here are small enough that cost isn't a concern) — Claude sentiment
  classification (direct `fetch` call, no SDK).
- `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` — fan-page velocity alert
  emails (direct `fetch` call, no SDK). `ALERT_EMAIL_FROM` can be Resend's sandbox
  address (`onboarding@resend.dev`, delivers only to the email your Resend account was
  signed up with) until a domain is verified for real recipients.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | `prisma generate` + `next build` |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest |
| `npm run test:e2e` | Playwright (26 browser-verification tests, see `e2e/`) |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run db:migrate` | `prisma migrate dev` against `DATABASE_URL` |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:studio` | Prisma Studio |
| `npm run data-rights:lookup -- <handle>` | Read-only DPDP access/deletion-request lookup — see `DATA-PRIVACY.md` |
| `npm run audit:raw-payload` | Reports which fields actually appear in raw scrape payloads, without printing values — informs retention decisions |

## Architecture

### Routes (`src/app`)

- `(app)/` — authenticated shell: Dashboard (`/`), Content (`/content`), Audience
  (`/audience`), Compare (`/compare` — competitor tracking, now Instagram **and**
  YouTube via a platform selector on Add Competitor), Campaigns (`/campaigns`,
  own/hashtag/agency sub-views — hashtag tracking stays Instagram-only, see Providers),
  Fan Pages (`/fan-pages` — fan-account tracking, also Instagram **and** YouTube).
- `login/` — Google sign-in page.
- `api/auth/[...nextauth]` — Auth.js handler.
- `api/agency-run/[id]/status` — polling endpoint for an in-progress agency scrape run.
- `api/cron/poll-hashtags`, `api/cron/backfill-sentiment` — scheduled jobs (Vercel Cron).
- `api/dev/scrape-hashtag` — manual dev-only trigger for the hashtag scraper.

### Data & providers (`src/lib`)

- `data/` — per-screen query/aggregation layer (`dashboard.ts`, `content.ts`,
  `audience.ts`, `compare.ts`, `campaigns.ts`, `agency.ts`, `fanpages.ts`,
  `fanPageAlerts.ts`, `sentiment.ts`) that pages read from.
- `providers/` — swappable data sources behind small interfaces
  (`InstagramInsightsProvider`, `PublicContentProvider`, `SentimentProvider`,
  `NotifierProvider`), each with a `mock-*` and a live implementation. Which one is
  selected is controlled entirely by the `DATA_MODE_*` env vars via `providers/index.ts`
  — no code change needed to flip a provider live. `PublicContentProvider` now has two
  live implementations behind a `Platform` (`instagram` | `youtube`) column added to
  `Post`/`CompetitorAccount`/`FanPage`: `apify-public-content.ts` (Instagram, scraped via
  Apify) and `youtube-public-content.ts` (YouTube, direct official Data API v3 fetch —
  no scraping needed, YouTube has an accessible public API). `platform-utils.ts` holds
  the shared handle-validation/provider-selection logic both Compare and Fan Pages need
  so the two don't duplicate platform-dispatch logic.
- `apify/client.ts` — thin Apify actor client used by the live Instagram `PublicContentProvider`.
- `scoring/` — campaign/agency post scoring (`scorePost.ts`, `cohort.ts`, `config.ts`).
- `upload/` — agency report upload/ingestion handling.
- `actions/` — server actions.

### Auth

`src/auth.ts` wires Google OAuth through Auth.js v5, gates sign-in on
`ALLOWED_EMAIL_DOMAIN`/`ALLOWED_EMAILS`, and best-effort upserts `users.role` into
Postgres on login (falls back to `role: "team"` if the database isn't reachable, so
local dev works without a live Supabase project).

## Testing

`npm run test:e2e` drives all 9 screens (12 captures) in a real browser against seeded
mock data, behind real auth (a session token minted the same way Auth.js's own
`encode()` would produce one). See `e2e/PHASE0-VERIFICATION.md` for what that harness
verifies, what it deliberately doesn't, and the fidelity gaps it already found and fixed
against the HTML prototype (`staranalytics_prototype.html`).

## Project status

Phases 0–6 are merged to `main` (prototype parity, real providers, sentiment pipeline,
campaign/agency scoring, fan page alerts, hashtag search). Phase 7 (a Graph API–backed
self-account dashboard) has a real `GraphInstagramInsightsProvider` implementation
(`src/lib/providers/graph-instagram-insights.ts`) wired behind `DATA_MODE_INSTAGRAM=live`,
written and unit-tested against documented API response shapes — but never exercised
against a live account, since that requires Meta App Review (Business/Creator account
conversion, a registered Meta app, and approved `instagram_basic`/`instagram_manage_insights`
permissions). Re-verify field names against a real response once a token exists. Two
fields (`AccountInsights.profileVisits`, `Demographics.heatmap`) have no current Graph API
equivalent and are flagged inline in that file for a product decision before shipping.

**YouTube (added 2026-07-24, after the phases above)** turns Compare and Fan Pages into
genuinely multi-platform features — not part of the original phase plan, added once a
`YOUTUBE_API_KEY` was in hand. Verification status differs by surface, so don't assume
"YouTube works" covers all of it:
- **Fan Pages: confirmed against the real YouTube API** — a real channel (`@mkbhd`) was
  added through the actual UI, 25 real videos linked with real view counts, cleaned up
  after.
- **Compare (competitor tracking): verified end-to-end through the real UI, but only in
  mock mode** — a real DB row and platform badge were confirmed, not a live Data API call.
- **Deliberately not extended to YouTube**: hashtag/campaign tracking (`scrapeByHashtag`
  throws an explicit "out of scope" error for YouTube rather than doing something wrong
  silently — YouTube has no hashtag-scrape equivalent in this provider), and own-channel
  YouTube Analytics (impressions/demographics need a separate OAuth-based YouTube
  Analytics API integration — deferred, same shape as Phase 7's Meta App Review gate).
- Naming debt accepted on purpose: `igShortcode`/`igHandle` field names were kept as-is
  rather than renamed to something platform-neutral, to avoid touching 9+ call sites
  across the ingestion pipeline on tables with real production data. They now hold
  YouTube video ids/channel handles too — documented inline at each site, not a bug.

**Security & DPDP audit (2026-07-28, two PRs)** found and fixed a real gap: every Server
Action (`createCampaign`, `trackHashtag`, `addCompetitor`, `removeCompetitor`,
`addFanPage`, `analyseAgencyPosts`, `getAgencyRunResults`) and the dev scrape route were
directly POST-reachable regardless of auth state — the `(app)` layout's redirect never
actually protected them, since Server Actions bypass page/layout rendering entirely. All
now require a session via a shared `requireSession()` guard. Also patched in the same
pass: `xlsx` (CDN 0.20.3, npm's last published 0.18.5 doesn't carry the
prototype-pollution/ReDoS fixes), two critical `next-auth`/`@auth/core` CVEs in the
Google OAuth flow, and security headers added to `next.config.ts` for the first time
(HSTS, `X-Frame-Options`, `X-Content-Type-Options`, a minimal `frame-ancestors` CSP —
not a full `script-src` CSP, since the app embeds Google's OAuth UI and Supabase
Realtime). The DPDP half added `DATA-PRIVACY.md`, the rights-request lookup script, and
raw-payload minimization — see the bullets below.

## Known limitations

- **Cron cadence is once/day, not every 15 minutes.** `vercel.json`'s `poll-hashtags`
  cron was originally built for a 15-minute interval, but Vercel's Hobby plan caps
  crons at once/day — every deploy since the cron was added had been silently failing
  (`deploy_failed`) as a result, discovered only during a later full walkthrough. It's
  currently pinned to `0 6 * * *` to unblock deploys. Hashtag volume, fan-page linking,
  velocity alerts, and `/compare` competitor refresh are all only as fresh as the last
  daily run — move back to `*/15` (or an external scheduler hitting the cron routes
  directly) once the project is on a paid Vercel plan.
- **Fan-page alert emails are sandboxed.** With `ALERT_EMAIL_FROM` set to Resend's
  sandbox address, delivery only works to the single email your Resend account was
  signed up with. Verify a domain with Resend before relying on alerts reaching anyone
  else.
- **Two cron jobs are now configured** (`poll-hashtags`, `prune-raw-payloads`) — both
  once/day, which fits Vercel Hobby's typical 2-cron-job cap, but confirm against your
  actual plan before deploying if that limit has changed.
- **The Topbar date-range control is visibly disabled everywhere, on purpose, not
  unbuilt-and-forgotten.** `AccountInsights` has no date parameter today (mock/Phase 7
  data is a single fixed snapshot); wiring the selector would mean fabricating per-range
  numbers, exactly what this project's "not evaluated, not fabricated" discipline exists
  to avoid. It gets an honest home once Phase 7's since/until-based Graph API provider
  is live. CSV export is similarly scoped rather than universal: it's wired for Campaigns
  list and the Agency Report's posts table (real DB data), and disabled with a tooltip on
  Dashboard/Content/Audience, which are still on mock `InstagramInsights` pending Phase 7.
- **Sentiment classification is more resilient and accurate than it was at Phase 4.**
  The per-batch loop now survives a single failing batch instead of silently abandoning
  every batch queued after it (a real case sat at 39/89 classified for hours because of
  this); the prompt was reworked around reasoning about intent/sarcasm/negation rather
  than accumulating special-case pattern rules after a real misclassification (wistful
  heartbreak comments scored as negative); and the default model is `claude-opus-4-8`
  (bumped from Sonnet), confirmed better on code-mixed Malayalam/English/slang text.
- **`UserRole` (`admin`/`team`/`agency_viewer`) is stored but deliberately unenforced** —
  every logged-in user gets full access, a documented product decision, not an oversight.
  There's also no schema link between `User` and `Agency`, so an `agency_viewer` couldn't
  be scoped to just their own agency's data even if role-checking were added — link that
  before onboarding the first external agency login, not after.
- **The Compare page's "Live" indicator polls rather than truly streams.**
  `LiveStream.tsx` used Supabase Realtime, which turned out to be silently
  non-functional in production: RLS is enabled with zero policies, so the public
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` can't read any row — it would connect and show "Live"
  but never actually receive an event. Granting the anon key read access would have
  fixed that while reintroducing a public, non-expiring credential with direct read
  access to Confidential campaign data. Replaced with 8-second authenticated polling
  through the same `requireSession()`-gated data layer as the rest of the app instead.
- **Raw scrape payloads are minimized, not fully retained forever.** `posts.raw` /
  `post_comments.raw` store the complete Apify response but nothing reads them back
  (confirmed by grep — `npm run audit:raw-payload` reports what's actually in them
  without ever printing values). The `prune-raw-payloads` cron nulls `raw` past
  `RAW_PAYLOAD_RETENTION_DAYS` (default 90, a flagged assumption, not a researched
  number). Structured data (captions, comments, sentiment, engagement counts) still has
  **no** retention policy — that's a real open product decision, not an oversight.
- **DPDP legal basis is a working assumption, not a confirmed legal position, and formal
  counsel confirmation is deliberately not being pursued.** Everything scraped (posts,
  comments, competitor/fan accounts) relies on DPDP §3(c)(ii)'s public-data exclusion —
  reasonable, but never legally confirmed, by product decision rather than oversight.
  Nothing else in the app or in `DATA-PRIVACY.md` is blocked on this. See
  `DATA-PRIVACY.md` for the full posture, the rights-request lookup tool
  (`npm run data-rights:lookup -- <handle>`, read-only), and what else is flagged vs.
  actually built.

## Repo-specific note

`AGENTS.md` flags that this project pins a Next.js version whose APIs/conventions may
differ from generic training data — check `node_modules/next/dist/docs/` before relying
on remembered Next.js behavior.

---
*Reconciled against the actual codebase 2026-07-29 (`git log`, `prisma/schema.prisma`,
`.env.example`, `src/lib/providers/`, `DATA-PRIVACY.md`), in two passes — this file
previously described an Instagram-only product; it was last written 2026-07-24 and 12
commits (the YouTube platform addition, search/CSV-export/date-range decisions, and
sentiment pipeline hardening) landed after that pass without updating it. The local
checkout was also found behind `origin/main` both times this session (12, then a further
8, commits — the second batch being a dedicated security pass and a DPDP privacy/access
audit) and was fast-forward-pulled each time before reconciling, so this reflects
`origin/main` as of commit `f6b7bb0`, not a stale local snapshot. Every claim above was
checked against real code and real commit messages, not carried over from the previous
version.*

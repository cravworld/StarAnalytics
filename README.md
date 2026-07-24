# StarAnalytics

A Next.js dashboard for tracking Instagram performance across a self account, competitors,
fan pages, and third-party campaign agencies for Malayalam film/celebrity promotion —
engagement, sentiment, and campaign scorecards in one place.

## Stack

- Next.js 16 (App Router) + React 19
- NextAuth (Auth.js v5) with Google OAuth, JWT sessions, email-domain/allowlist gating
- Prisma + Postgres (Supabase)
- Chart.js / react-chartjs-2
- Apify (public Instagram scraping) + Claude (sentiment classification) + Resend (fan-page alert emails)
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
- `DATA_MODE_INSTAGRAM` / `DATA_MODE_APIFY` / `DATA_MODE_SENTIMENT` / `DATA_MODE_NOTIFIER`
  — per-provider `mock` | `live` switches (see Providers below).
- `APIFY_TOKEN`, `APIFY_ACTOR_HASHTAG`, `APIFY_ACTOR_PROFILE`, `APIFY_ACTOR_POST`,
  `APIFY_ACTOR_COMMENTS` — Apify actor wiring for live scraping.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_SENTIMENT_MODEL` — Claude sentiment classification
  (direct `fetch` call, no SDK).
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

## Architecture

### Routes (`src/app`)

- `(app)/` — authenticated shell: Dashboard (`/`), Content (`/content`), Audience
  (`/audience`), Compare (`/compare`), Campaigns (`/campaigns`, own/hashtag/agency
  sub-views), Fan Pages (`/fan-pages`).
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
  — no code change needed to flip a provider live.
- `apify/client.ts` — thin Apify actor client used by the live `PublicContentProvider`.
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
campaign/agency scoring, fan page alerts, hashtag search). The remaining phase — a
Graph API–backed self-account dashboard — is gated on Meta App Review and not yet
started.

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

## Repo-specific note

`AGENTS.md` flags that this project pins a Next.js version whose APIs/conventions may
differ from generic training data — check `node_modules/next/dist/docs/` before relying
on remembered Next.js behavior.

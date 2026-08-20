# Data Privacy Notes (internal)

Not user-facing — this is the operating record from a DPDP (India's Digital Personal Data Protection Act) focused privacy/access-control audit, so decisions about what's collected and why aren't just tribal knowledge.

*Originally written 2026-07-28/30. Reviewed and extended 2026-08-20 to cover what shipped since: Scoutline (bulk talent scanning), per-comment sentiment, Theater Campaign Intelligence, and — the material change — the cross-provider sentiment fallback, which sends third-party comment text to two recipients this document previously did not name.*

## What's collected and why

| Data | Table(s) | Whose data | Purpose |
|---|---|---|---|
| Account email/name/role | `users` | Internal team / agency logins | Access control for the app itself |
| Post caption, author handle, engagement counts | `posts` | Public post authors (third parties, not our users) | Campaign/competitor analytics |
| Full raw scrape payload | `posts.raw`, `post_comments.raw` | Same | Never read back by the app (confirmed by grep) — kept only as an ingestion artifact. Run `npm run audit:raw-payload` to see what's actually in it. Pruned after `RAW_PAYLOAD_RETENTION_DAYS` (default 90) by the `prune-raw-payloads` cron |
| Comment text + author handle | `post_comments` | Public commenters (third parties) | Sentiment analysis input. Read exactly once (by the classifier) and never again — nulled after `COMMENT_RETENTION_DAYS` (default 90) by the same cron; the row itself is kept so comment counts stay accurate |
| Handle, display name, follower count | `competitor_accounts`, `fan_pages` | Public account owners | Competitor/fan tracking |
| Sentiment label/score/keywords | `sentiment` | Derived from the above | Campaign performance signal |
| Per-comment sentiment label/score | `comment_sentiment` | Derived from `post_comments` | Comment-level sentiment breakdown (`/campaigns/comments`, fan-page comment panels) |
| Talent handle, supplied name, follower/engagement stats | `scout_candidates`, `scout_batch_entries`, `scout_snapshots`, `scout_scores` | Public account owners (third parties) — influencers/talent on someone's shortlist | Scoutline: bulk talent scanning and Buzz Factor ranking. `supplied_name` comes from the uploaded source sheet, not from scraping |
| Full raw Scoutline scrape payload | `scout_snapshots.raw` | Same | Ingestion artifact from the profile-analytics actor. **Not currently pruned** — see Retention, open item 2 |
| Theatre, screening, seat-availability status | `theaters`, `screenings`, `availability_snapshots`, `bms_scan_runs`, `theater_campaigns` | **Nobody's** — this is a business's showtime listing, not personal data | Theater Campaign Intelligence demand tracking. Listed here so the absence of a privacy question is explicit rather than an omission: no individual is identified, and BookMyShow exposes no booker-level data on any page this feature reads |

## Legal basis

- **Internal `users` table**: legitimate use — this is access control for an internal tool, not personal data collected from the public.
- **Everything scraped** (posts, comments, competitor/fan-page accounts, Scoutline talent candidates, sentiment): the operative basis is **DPDP §3(c)(ii)**, which excludes personal data "made publicly available by the Data Principal" from the Act's scope — applicable as long as scraping stays limited to genuinely public posts/profiles/comments (not private/locked accounts, not DM content). **Formal counsel confirmation of this basis is not being pursued** — a product decision, not an oversight. The app proceeds on this working assumption; if that ever needs revisiting (e.g. a regulator inquiry, a scale change), this paragraph is where that conversation starts.
- **Scoutline has one provenance wrinkle worth naming** (2026-08-20): the handles it scans are public and the metrics come from public profiles, so the §3(c)(ii) reasoning above carries. But `scout_batch_entries.supplied_name` does not — it is typed into a source sheet by whoever built the shortlist, not published by the person it names. It is low-sensitivity (a name already attached to a public handle) and it is not redistributed anywhere, so this is flagged as a known distinction rather than an identified problem. It does mean "everything we hold was made public by the person themselves" is not literally true of every column.
- Sentiment scoring is algorithmic profiling of public commenters whose age is unknowable from a scraped handle. There's no way to exclude possible minors from this — treat it as a standing structural risk to disclose if this is ever formally reviewed, not something fixable in code.

## Access control status

- Every Server Action and the dev scrape route require an authenticated session (merged via PR #1) — previously these were reachable by anyone, unauthenticated. Re-verified 2026-08-20: all **18** actions across `src/lib/actions/{agency,campaigns,compare,fanpages,theaterCampaigns}.ts` go through `requireSession()`, including the ones added since the original audit (campaign events, weekly-digest-now, fan-page history pull / refresh-all / verified toggle / stop-tracking, and the three theatre-campaign actions).
- **Two endpoints deliberately sit outside NextAuth**: `api/theater-campaigns/[id]/ingest` and `api/theater-campaigns/[id]/capture-plan`. The BookMyShow capture script is a scheduled process on an operator's machine with no browser session, so it cannot present one. They are gated on the `BOOKMYSHOW_CAPTURE_SECRET` shared secret instead and fail closed when it is unset, and the ingest route additionally enforces a server-side `BOOKMYSHOW_CAPTURE_MAX_PER_DAY` ceiling. They carry no personal data, but they are the only unauthenticated write paths in the app and should be re-checked whenever that secret handling changes.
- All `/api/cron/*` routes require a `CRON_SECRET` bearer token and fail closed (500) without it.
- `UserRole` (`admin`/`team`/`agency_viewer`) is stored but deliberately unenforced — a documented product decision that all logged-in users get full access. Worth knowing: there's no schema link between `User` and `Agency`, so even if role-checking were added, an `agency_viewer` couldn't be scoped to their own agency's data without a schema change first. If an external agency's email is ever added to `ALLOWED_EMAILS`, that account sees everything — all competitors, all other agencies' scores, all raw scrape data.
- RLS is enabled on the Supabase project but has no policies (deny-all for the public anon key) — that protects the anon key, not the app itself, since the app connects via the `postgres` role which bypasses RLS. All authorization is in application code.

## Cross-border processing

- **Anthropic (Claude API, US)** — receives post/comment `text` only for sentiment scoring, not the author handle. Good minimization already in place.
- **OpenAI (US)** and **Google (Gemini API, US)** — **receive exactly the same comment text as Anthropic**, whenever the Claude call fails. This is not a hypothetical path: the Claude → OpenAI → Gemini fallback chain was added in response to a real Anthropic credit exhaustion, and a batch moves down the chain on *any* failure (rate limit, credit, network). Same minimization applies — text only, no author handle — but the recipient list is three US processors, not one. This was the one materially wrong statement in this document before 2026-08-20, when it named Anthropic as the sole recipient. If the fallback keys are left unset, those legs throw immediately and no data reaches them; that is a configuration state, not a guarantee, and it should not be relied on as one.
- **Resend (US)** — internal alert emails and the weekly digest only.
- **Apify (scraping)** and **Google (YouTube Data API)** — inbound data sources, not outbound personal-data transfers. The same holds for the BookMyShow scan path, which carries no personal data in either direction.
- All currently permitted under DPDP §16 (no government blacklist in effect). Documented here since 2026-07-28; the OpenAI/Gemini leg since 2026-08-20.

## Retention

`prune-raw-payloads` (cron, once/day, `src/app/api/cron/prune-raw-payloads/route.ts`) runs two jobs:

1. Nulls out `posts.raw`/`post_comments.raw` once a row is older than `RAW_PAYLOAD_RETENTION_DAYS` (default **90**). Safe to run: confirmed by grep that no code path reads `raw` back out, so nulling it doesn't touch any feature — only `caption`, `authorHandle`, and the engagement-count columns (already extracted at ingest time) are ever used.
2. Nulls out `post_comments.text`/`post_comments.author_handle` once a row is older than `COMMENT_RETENTION_DAYS` (default **90**). Same reasoning, same "confirmed by grep it's never read back" bar: comment text/handle is read exactly once, by the sentiment classifier (`src/lib/data/sentiment.ts`), to derive a `sentiment` row, and never again after. The row itself isn't hard-deleted — `id`/`postId`/`scrapedAt` stay so comment counts remain accurate; only the third-party commenter's actual content is cleared.

Both defaults are policy decisions, not engineering ones — 90 days each because nothing in the codebase implied a real number. Change the env var if that's wrong for how this data actually gets used.

**Not pruned, and this one is a genuine gap rather than a decision** (found 2026-08-20, raised as open item 2 below): `scout_snapshots.raw` holds the complete profile-analytics payload for every Scoutline candidate — third-party influencers who were put on someone's shortlist, not accounts this business has any relationship with. The `prune-raw-payloads` cron only touches `posts.raw`, `post_comments.raw` and `post_comments.text`/`author_handle`; the Scoutline tables did not exist when it was written (2026-07-30 vs 2026-08-17) and nobody extended it. Same "kept only as an ingestion artifact" rationale as `posts.raw` applies, which is exactly why the same treatment should.

**Deliberately not pruned**, and why each is a real "not yet" rather than an oversight:
- `posts.caption` / engagement counts (`reach`/`likes`/`comments`/`saves`/`shares`) — this is the tracked accounts' own public content, and it's the entire analytics product (trend charts, "Top Posts This Month"). There's no data-minimization argument for deleting a business's own historical performance data; a retention policy here would be a product regression, not a privacy improvement.
- `sentiment` rows — already a minimized derived signal (a label, a score, a handful of keywords), no raw text. Nothing left to minimize further.

So "structured data" wasn't one policy decision, it was two different buckets that needed two different answers — the personal-data one (comments) now has a retention window; the business-data one (posts/sentiment) deliberately doesn't, and shouldn't.

## Handling an access/correction/deletion request

Run:
```
npm run data-rights:lookup -- <handle>
```
(`scripts/lookup-personal-data.mjs`) — pulls every row referencing that handle across `posts`, `post_comments`, `competitor_accounts`, and `fan_pages`, plus that post's sentiment score. **Read-only** — it does not delete anything.

⚠️ **The script does not cover the Scoutline tables** (verified 2026-08-20: it queries exactly the four models above and no others). A handle that appears only in `scout_candidates` / `scout_batch_entries` / `scout_snapshots` — i.e. an influencer who was scanned as part of a talent shortlist but never tracked as a fan page or competitor — returns **no results, which reads identically to "we hold nothing on this person."** For any request involving talent/influencer data, query those tables directly (`npm run db:studio`) until the script is extended. Same caveat applies to `comment_sentiment`, which is keyed on the comment row rather than the handle. Review the output and delete by id yourself (e.g. via `npm run db:studio`) if a deletion is actually warranted. In practice, a request is far more likely to arrive as a legal/regulatory inquiry than a data principal contacting us directly, since these are third parties with no relationship to or awareness of this system.

## Breach response

`scrape_runs` gives an ingestion timeline (what was scraped, when) but there's no query-level audit log of who read what inside the app. If the DB were compromised, start from `scrape_runs` and the affected tables to scope what was exposed. For the scraped third-party data specifically, direct principal notification is largely infeasible (no contact channel exists) — breach response for that data class is realistically about containment and regulator disclosure, not individual notice.

## Open items (flagged, not built)

These came out of the audit as real gaps but are scope/product decisions, not something to build unprompted:
1. **Link `User` to `Agency`** in the schema if `agency_viewer` scoping is ever actually needed — currently structurally impossible without this. Deferred: no `agency_viewer` account exists yet, so this would be speculative work. Do this **before** onboarding the first external agency login, not after. Independent of the retention policy above — this is an access-control gap, not a legal one.

2. **Extend `prune-raw-payloads` to `scout_snapshots.raw`** (raised 2026-08-20, not built). The Scoutline tables landed after the retention cron was written and were never added to it, so raw third-party profile payloads accumulate indefinitely while the equivalent post/comment payloads prune at 90 days. This is a straightforward inconsistency rather than a judgement call: same data class, same "never read back after ingest" property, different treatment purely by accident of ordering. Whether the *derived* Scoutline data (handles, scores, snapshots) should also have a window is a real product question and deliberately left open — a talent shortlist's value is partly historical, the same argument that keeps posts' own engagement data forever.

~~3. Decide a real retention policy for structured data~~ — **resolved 2026-07-30**: see "Retention" above. `post_comments.text`/`author_handle` (the actual third-party personal data in the structured-data set) now prunes on `COMMENT_RETENTION_DAYS`; posts' own caption/engagement data and derived `sentiment` rows are deliberately kept indefinitely, for reasons documented in that section.

**Migration status** (revised 2026-08-20): `prisma/migrations/20260730120000_post_comment_text_nullable` was hand-written, because this environment's local DB credentials fail auth against Supabase, and was recorded here as pending. It is now very likely applied — `npm run build` runs `prisma migrate deploy`, and 12 further migrations have been authored and deployed since, which that command would have applied in order. This has **not** been confirmed against the live database from here (still no working credentials), so it is stated as reasoning rather than fact. Confirm with `npx prisma migrate status` against the production `DIRECT_URL` if it matters for a decision.

## Deliberately not pursued (a decision was made, not a gap)

- **Formal counsel confirmation of the DPDP §3(c)(ii) legal basis** — decided against pursuing this. The app continues to operate on the working assumption described in "Legal basis" above without a formal legal opinion behind it. Nothing else in this document, nor any open item above, is blocked on this — the two open items above stand on their own regardless of whether that confirmation ever happens.

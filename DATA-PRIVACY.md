# Data Privacy Notes (internal)

Not user-facing — this is the operating record from a DPDP (India's Digital Personal Data Protection Act) focused privacy/access-control audit, so decisions about what's collected and why aren't just tribal knowledge.

## What's collected and why

| Data | Table(s) | Whose data | Purpose |
|---|---|---|---|
| Account email/name/role | `users` | Internal team / agency logins | Access control for the app itself |
| Post caption, author handle, engagement counts | `posts` | Public post authors (third parties, not our users) | Campaign/competitor analytics |
| Full raw scrape payload | `posts.raw` | Same | Not yet audited for exact contents — see Open Items |
| Comment text + author handle | `post_comments` | Public commenters (third parties) | Sentiment analysis input |
| Handle, display name, follower count | `competitor_accounts`, `fan_pages` | Public account owners | Competitor/fan tracking |
| Sentiment label/score/keywords | `sentiment` | Derived from the above | Campaign performance signal |

## Legal basis

- **Internal `users` table**: legitimate use — this is access control for an internal tool, not personal data collected from the public.
- **Everything scraped** (posts, comments, competitor/fan-page accounts, sentiment): the operative basis is **DPDP §3(c)(ii)**, which excludes personal data "made publicly available by the Data Principal" from the Act's scope — applicable as long as scraping stays limited to genuinely public posts/profiles/comments (not private/locked accounts, not DM content). **This has not been formally confirmed by counsel** — it's the audit's working assumption, not a settled legal position. Get that confirmed before treating it as closed, especially as scale grows.
- Sentiment scoring is algorithmic profiling of public commenters whose age is unknowable from a scraped handle. There's no way to exclude possible minors from this — treat it as a standing structural risk to disclose if this is ever formally reviewed, not something fixable in code.

## Access control status

- Every Server Action (`createCampaign`, `trackHashtag`, `addCompetitor`, `removeCompetitor`, `addFanPage`, `analyseAgencyPosts`, `getAgencyRunResults`) and the dev scrape route now require an authenticated session (merged via PR #1) — previously these were reachable by anyone, unauthenticated.
- `UserRole` (`admin`/`team`/`agency_viewer`) is stored but deliberately unenforced — a documented product decision that all logged-in users get full access. Worth knowing: there's no schema link between `User` and `Agency`, so even if role-checking were added, an `agency_viewer` couldn't be scoped to their own agency's data without a schema change first. If an external agency's email is ever added to `ALLOWED_EMAILS`, that account sees everything — all competitors, all other agencies' scores, all raw scrape data.
- RLS is enabled on the Supabase project but has no policies (deny-all for the public anon key) — that protects the anon key, not the app itself, since the app connects via the `postgres` role which bypasses RLS. All authorization is in application code.

## Cross-border processing

- **Anthropic (Claude API, US)** — receives post/comment `text` only for sentiment scoring, not the author handle. Good minimization already in place.
- **Resend (US)** — internal alert emails only.
- **Apify (scraping)** and **Google (YouTube Data API)** — inbound data sources, not outbound personal-data transfers.
- All currently permitted under DPDP §16 (no government blacklist in effect) but undocumented until now.

## Retention

No automated retention or deletion exists — scraped data accumulates indefinitely. Not built here since a retention window (how long to keep raw payloads vs. structured/aggregated data) is a product decision, not an engineering default to invent unilaterally. Recommend defining one and then building a pruning job — flagging as an open item below.

## Handling an access/correction/deletion request

Run:
```
npm run data-rights:lookup -- <handle>
```
(`scripts/lookup-personal-data.mjs`) — pulls every row referencing that handle across `posts`, `post_comments`, `competitor_accounts`, and `fan_pages`, plus that post's sentiment score. **Read-only** — it does not delete anything. Review the output and delete by id yourself (e.g. via `npm run db:studio`) if a deletion is actually warranted. In practice, a request is far more likely to arrive as a legal/regulatory inquiry than a data principal contacting us directly, since these are third parties with no relationship to or awareness of this system.

## Breach response

`scrape_runs` gives an ingestion timeline (what was scraped, when) but there's no query-level audit log of who read what inside the app. If the DB were compromised, start from `scrape_runs` and the affected tables to scope what was exposed. For the scraped third-party data specifically, direct principal notification is largely infeasible (no contact channel exists) — breach response for that data class is realistically about containment and regulator disclosure, not individual notice.

## Open items (flagged, not built)

These came out of the audit as real gaps but are scope/product decisions, not something to build unprompted:
1. **Link `User` to `Agency`** in the schema if `agency_viewer` scoping is ever actually needed — currently structurally impossible without this.
2. **Define and automate a retention window**, especially for `posts.raw` (unbounded JSON, likely over-collecting beyond what any feature reads).
3. **Audit `posts.raw` contents** against what Apify's actors actually return, and strip fields nothing in the app uses.

"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { formatCompactNumber, formatIstDate } from "@/lib/format";
import { aggregate, type AggregateTotals } from "@/lib/tracking/insights";
import { OtherPostsPanel } from "@/components/tracking/OtherPostsPanel";
import { CategoryPicker } from "@/components/tracking/CategoryPicker";
import { CategoryManager } from "@/components/tracking/CategoryManager";
import {
  groupByCategory,
  matchesCategoryFilter,
  UNCATEGORISED_KEY,
  UNCATEGORISED_LABEL,
} from "@/lib/tracking/categories";
import type { CategorySection } from "@/lib/tracking/categories";
import type { CampaignTrackingView, TrackedAccountView, TrackedPostView } from "@/lib/data/trackedPosts";
import type { TrackPlatformId } from "@/lib/tracking/postUrl";
import type { AccountCategory } from "@/lib/tracking/categories";

const PLATFORM_LABEL: Record<TrackPlatformId, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

const MEDIA_ICON: Record<string, string> = {
  reel: "▶",
  video: "▶",
  short: "▶",
  carousel: "❐",
  image: "▣",
  photo: "▣",
};

/**
 * Renders a metric that may not have been measured.
 *
 * The single most important function in this file. Instagram never reports shares, a photo
 * has no play count, a private account has no follower count — and every one of those is
 * null, not zero. Rendering "0" for them would state a measurement that was never taken,
 * which is the failure CAMPAIGN-POST-TRACKING.md §1 exists to prevent. An em dash says
 * "not available" and cannot be mistaken for data.
 */
function Metric({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span style={{ color: "var(--ink-faint)" }} title="Not reported by this platform">—</span>;
  return (
    <>
      {formatCompactNumber(value)}
      {suffix}
    </>
  );
}

function pct(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

/**
 * How an account is named on screen.
 *
 * YouTube's stored `handle` is the channel ID (stable, unlike the mutable channel title),
 * so it must never be shown raw — "@UCabc123def" tells a human nothing. Instagram's handle
 * IS the recognisable name and is shown as-is.
 */
function accountLabel(platform: TrackPlatformId, handle: string, displayName: string | null): string {
  if (platform === "youtube") return displayName ?? handle;
  return `@${handle}`;
}

function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span style={{ color: up ? "var(--pencil-green)" : "var(--pencil-red)", fontWeight: 600 }}>
      {up ? "↑" : "↓"} {formatCompactNumber(Math.abs(value))}
    </span>
  );
}

function PostCard({ post }: { post: TrackedPostView }) {
  const icon = MEDIA_ICON[post.mediaType ?? ""] ?? "▣";
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card"
      style={{ display: "block", textDecoration: "none", padding: 12 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 20, color: "var(--ink-faint)" }} aria-hidden="true">
          {icon}
        </span>
        <Pill kind="default">{PLATFORM_LABEL[post.platform]}</Pill>
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
        {post.postedAt ? formatIstDate(post.postedAt) : "date unknown"}
        {post.mediaType ? ` · ${post.mediaType}` : ""}
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <span title="Likes">♥ <Metric value={post.likes} /></span>
        <span title="Comments">💬 <Metric value={post.comments} /></span>
        {/* Labelled "plays", never "reach" — a play count counts video starts, not people. */}
        <span title="Plays — video starts, not unique viewers">▶ <Metric value={post.views} /></span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-soft)" }}>
        <span>ER {pct(post.engagementRatePct, 2)}</span>
        <Delta value={post.engagementDelta} />
      </div>

      {post.lastError ? (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--pencil-red)" }}>{post.lastError}</div>
      ) : null}
    </a>
  );
}

/**
 * Follower change across the tracked period — the only page-level number here that isn't a
 * rollup of the page's posts.
 *
 * Renders nothing below two data points, rather than showing a flat "0". One snapshot is a
 * reading, not a trend, and "+0" would assert that the follower count was measured twice and
 * didn't move — which is a different claim from "we've only looked once".
 */
function FollowerTrend({ history }: { history: { at: Date; followers: number }[] }) {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const delta = last.followers - first.followers;
  if (delta === 0) return null;
  const up = delta > 0;
  const since = formatIstDate(first.at);
  return (
    <span
      style={{ color: up ? "var(--pencil-green)" : "var(--pencil-red)", fontWeight: 600 }}
      title={`Followers went from ${first.followers.toLocaleString("en-IN")} to ${last.followers.toLocaleString("en-IN")} since ${since}.`}
    >
      {up ? "↑" : "↓"} {formatCompactNumber(Math.abs(delta))} followers
    </span>
  );
}

function AccountHeader({
  account,
  campaignId,
  categories,
}: {
  account: TrackedAccountView;
  campaignId: string;
  categories: AccountCategory[];
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 10,
      }}
    >
      <div>
        {/* displayName first, handle as the fallback. For YouTube the handle is the channel
            ID by design (titles are mutable and non-unique), so heading a section
            "@UCabc123..." would be unreadable — the channel title is what a human
            recognises. Instagram keeps showing the handle, which IS the recognisable name
            there and is what displayName holds when the profile has no full name set. */}
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {accountLabel(account.platform, account.handle, account.displayName)}
        </span>
        {account.isSubscribed ? (
          <span
            className="score-chip chip-good"
            style={{ marginLeft: 8, fontSize: 10 }}
            title="This whole page is tracked — new posts are picked up automatically."
          >
            Page tracked
          </span>
        ) : null}
        <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
          {PLATFORM_LABEL[account.platform]}
          {" · "}
          {account.followersAvailable ? `${formatCompactNumber(account.followers ?? 0)} followers` : "followers hidden"}
          {" · "}
          {account.totals.posts} post{account.totals.posts === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ fontSize: 12, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <CategoryPicker
          campaignId={campaignId}
          accountId={account.id}
          categoryId={account.categoryId}
          categories={categories}
        />
        <FollowerTrend history={account.followerHistory} />
        <span>
          <strong><Metric value={account.totals.engagement} /></strong>{" "}
          <span style={{ color: "var(--muted)" }}>engagement</span>
        </span>
        <BaselineBadge account={account} />
      </div>
    </div>
  );
}

/**
 * "Did the post we paid for beat what they post for free?"
 *
 * Only rendered for accounts that came through Scoutline, and always labelled with the date
 * the baseline was measured. Both sides use the same formula — Scoutline's actor computes
 * `average_engagement_rate_pct` as the mean of (likes+comments)/followers*100 per post, which
 * is exactly what engagementRatePct() computes here — which is what makes the comparison a
 * real one rather than a units mismatch. Never substituted with a campaign-wide average for
 * accounts that were never scouted: that would silently change what the number means.
 */
function BaselineBadge({ account }: { account: TrackedAccountView }) {
  if (account.baselineDeltaPct === null) return null;
  const beat = account.baselineDeltaPct >= 0;
  const measured = account.baselineMeasuredAt
    ? formatIstDate(account.baselineMeasuredAt, { year: true })
    : null;
  return (
    <span
      className={`score-chip ${beat ? "chip-good" : "chip-warn"}`}
      title={`Their campaign posts average ${pct(account.baselineErPct === null ? null : account.baselineErPct)} engagement rate in Scoutline's scan${measured ? ` of ${measured}` : ""}. This compares their campaign posts against that.`}
    >
      {beat ? "↑" : "↓"} {Math.abs(account.baselineDeltaPct).toFixed(0)}% vs own baseline
    </span>
  );
}

function CoverageNote({ label, covered, total }: { label: string; covered: number; total: number }) {
  if (covered === total) return null;
  return (
    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
      {label}: {covered} of {total} posts
    </div>
  );
}


/**
 * The band above each group of accounts in the grid.
 *
 * Carries the group's own totals so the question the grouping exists to answer — "how did
 * the critics do against the vloggers" — is readable without adding up the cards below.
 * Its numbers come from the filtered posts, so they always describe exactly what is drawn
 * underneath them.
 */
function SectionHeader({
  section,
  totals,
}: {
  section: CategorySection<TrackedAccountView>;
  totals: AggregateTotals | undefined;
}) {
  const posts = section.accounts.reduce((n, a) => n + a.posts.length, 0);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        flexWrap: "wrap",
        borderBottom: "2px solid var(--rule)",
        paddingBottom: 6,
        marginBottom: 10,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
        {section.name}
        {/* Said plainly rather than styled differently and left to be inferred: these
            accounts have not been filed, which is a thing to go and do. */}
        {section.isReal ? null : (
          <span style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
            not filed under a category yet
          </span>
        )}
      </h2>
      <div style={{ fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>
          {section.accounts.length} account{section.accounts.length === 1 ? "" : "s"} · {posts} post
          {posts === 1 ? "" : "s"}
        </span>
        <span>
          <strong>
            <Metric value={totals?.engagement ?? null} />
          </strong>{" "}
          <span style={{ color: "var(--muted)" }}>engagement</span>
        </span>
        <span>
          <strong>
            <Metric value={totals?.views ?? null} />
          </strong>{" "}
          <span style={{ color: "var(--muted)" }}>plays</span>
        </span>
      </div>
    </div>
  );
}

/**
 * One row per category — the collective comparison across groups.
 *
 * Share-of-engagement is computed against the sum of the sections shown, which equals the
 * filtered campaign total precisely BECAUSE an account can only be filed under one category
 * (see CAMPAIGN-POST-TRACKING.md §14). If accounts could carry several, these percentages
 * would total more than 100% and the column would be quietly meaningless.
 *
 * Rendered as "—" rather than 0% when engagement is unmeasured, on the same principle as
 * every other metric on this screen.
 */
function CategoryTotalsTable({
  sections,
  totals,
  campaignTotal,
}: {
  sections: CategorySection<TrackedAccountView>[];
  totals: Map<string, AggregateTotals>;
  campaignTotal: number | null;
}) {
  return (
    <Card title="By category">
      <div className="tbl-scroll">
        <table className="post-tbl">
          <thead>
            <tr>
              <th>Category</th>
              <th>Accounts</th>
              <th>Posts</th>
              <th>Likes</th>
              <th>Comments</th>
              <th>Plays</th>
              <th>Engagement</th>
              <th>Avg / post</th>
              <th>Share of engagement</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const total = totals.get(section.key);
              const posts = section.accounts.reduce((n, a) => n + a.posts.length, 0);
              const engagementTotal = total?.engagement ?? null;
              const share =
                engagementTotal !== null && campaignTotal !== null && campaignTotal > 0
                  ? (engagementTotal / campaignTotal) * 100
                  : null;
              return (
                <tr key={section.key}>
                  <td>
                    <strong>{section.name}</strong>
                  </td>
                  <td>{section.accounts.length}</td>
                  <td>{posts}</td>
                  <td>
                    <Metric value={total?.likes ?? null} />
                  </td>
                  <td>
                    <Metric value={total?.comments ?? null} />
                  </td>
                  <td>
                    <Metric value={total?.views ?? null} />
                  </td>
                  <td>
                    <strong>
                      <Metric value={engagementTotal} />
                    </strong>
                  </td>
                  <td>
                    <Metric value={engagementTotal === null || posts === 0 ? null : Math.round(engagementTotal / posts)} />
                  </td>
                  <td>{share === null ? "—" : `${share.toFixed(0)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
        An account is filed under one category, so these rows add up to the campaign total
        rather than overlapping. Accounts you haven&apos;t filed yet appear under
        &ldquo;{UNCATEGORISED_LABEL}&rdquo; — file them from the grid or the account totals
        table.
      </div>
    </Card>
  );
}

export function TrackedPostsView({ data }: { data: CampaignTrackingView }) {
  const [view, setView] = useState<"grid" | "leaderboard" | "accounts" | "categories">("grid");
  const [platform, setPlatform] = useState<"all" | TrackPlatformId>("all");
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  // accountId -> categoryId, so the category filter can be applied to a POST. Without this
  // the filter could only narrow the account list, and filteredPosts — which the KPI row and
  // the All-posts table are both built from — would silently ignore it, leaving the header
  // and the body of the page describing different sets of posts.
  const categoryByAccountId = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a.categoryId])),
    [data.accounts],
  );

  const matches = (p: TrackedPostView) => {
    if (platform !== "all" && p.platform !== platform) return false;
    if (!matchesCategoryFilter(category, categoryByAccountId.get(p.accountId) ?? null)) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return p.accountHandle.toLowerCase().includes(q) || (p.caption ?? "").toLowerCase().includes(q);
  };

  const filteredPosts = useMemo(() => data.posts.filter(matches), [data.posts, platform, category, search]);

  // Totals are recomputed from the filtered posts, not carried over from the server's
  // unfiltered rollup. Filtering to one platform and still showing the all-platform total
  // in the account header is a number that contradicts the cards printed directly beneath
  // it — the aggregate must always describe exactly what is on screen.
  const filteredAccounts = useMemo(
    () =>
      data.accounts
        .map((a) => {
          const posts = a.posts.filter(matches);
          return {
            ...a,
            posts,
            totals: aggregate(
              posts.map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
            ),
          };
        })
        .filter((a) => a.posts.length > 0),
    [data.accounts, platform, category, search],
  );

  // accountId -> displayName, so the flat post table can name a YouTube channel without
  // TrackedPostView having to carry a second copy of it.
  const labelById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a.displayName])),
    [data.accounts],
  );

  const platformsPresent = useMemo(() => {
    const set = new Set(data.posts.map((p) => p.platform));
    return (["instagram", "facebook", "youtube"] as TrackPlatformId[]).filter((p) => set.has(p));
  }, [data.posts]);


  // Sections for the grid, built from the FILTERED accounts so a platform or search filter
  // empties a section out of existence rather than leaving an empty box behind.
  const sections = useMemo(
    () => groupByCategory(filteredAccounts, data.categories),
    [filteredAccounts, data.categories],
  );

  // Per-section rollups, summed from the same filtered posts the cards below them render.
  // Never a server-side rollup: a section header that stayed campaign-wide while its cards
  // showed one platform would be the same header/body contradiction the per-account totals
  // above are written to avoid.
  const sectionTotals = useMemo(
    () =>
      new Map(
        sections.map((section) => [
          section.key,
          aggregate(
            section.accounts
              .flatMap((a) => a.posts)
              .map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
          ),
        ]),
      ),
    [sections],
  );

  // Offered in the filter only when there is something to choose between — same rule as
  // platformsPresent. Derived from ALL the campaign's accounts rather than the filtered
  // ones, so choosing a category never removes the option you just chose from the list.
  const categoriesPresent = useMemo(() => {
    const used = new Set(data.accounts.map((a) => a.categoryId ?? UNCATEGORISED_KEY));
    const inOrder = data.categories.filter((c) => used.has(c.id)).map((c) => ({ key: c.id, name: c.name }));
    if (used.has(UNCATEGORISED_KEY)) inOrder.push({ key: UNCATEGORISED_KEY, name: UNCATEGORISED_LABEL });
    return inOrder;
  }, [data.accounts, data.categories]);

  // Accounts, not posts, and campaign-wide rather than filtered — this labels the category
  // list in the manager, which states a fact about the campaign, not about whatever filter
  // happens to be switched on.
  const accountsPerCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of data.accounts) {
      if (!a.categoryId) continue;
      counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [data.accounts]);

  // Same reasoning as the per-account totals above: every number on the page describes the
  // same set of posts. A KPI row that stayed campaign-wide while the grid below it showed
  // one platform would have the header and the body disagreeing with no indication why.
  const t = useMemo(
    () =>
      aggregate(
        filteredPosts.map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
      ),
    [filteredPosts],
  );
  const filtered = filteredPosts.length !== data.posts.length;

  return (
    <>
      <div className="kpi-grid kpi-grid-4">
        <div className="kpi">
          <div className="kpi-label">{filtered ? "Posts (filtered)" : "Posts tracked"}</div>
          <div className="kpi-val">{t.posts}</div>
          <div className="kpi-delta">
            across {filteredAccounts.length} account{filteredAccounts.length === 1 ? "" : "s"}
            {filtered ? ` · ${data.posts.length} tracked in total` : ""}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total engagement</div>
          <div className="kpi-val">
            <Metric value={t.engagement} />
          </div>
          <div className="kpi-delta">likes + comments</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Plays</div>
          <div className="kpi-val">
            <Metric value={t.views} />
          </div>
          {/* Coverage stated, always. A views total that silently covers 12 of 34 posts
              reads as a campaign-wide figure and isn't one. */}
          <CoverageNote label="Reported for" covered={t.coverage.views} total={t.posts} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Comments</div>
          <div className="kpi-val">
            <Metric value={t.comments} />
          </div>
          <div className="kpi-delta">
            {t.engagement && t.comments ? `${((t.comments / t.engagement) * 100).toFixed(0)}% of engagement` : "—"}
          </div>
        </div>
      </div>

      {/* Said once, plainly, rather than hedged on every tile. */}
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
        Reach and saves are private to the account owner and are not available for anyone
        else&apos;s account on any platform — these are public metrics only. Engagement rate is
        measured against follower count, which is a proxy for audience size, not reach.
      </div>

      <CategoryManager
        campaignId={data.campaign.id}
        categories={data.categories}
        counts={accountsPerCategory}
      />

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`btn ${view === "grid" ? "btn-primary" : ""}`} onClick={() => setView("grid")}>
          Grid by account
        </button>
        <button className={`btn ${view === "categories" ? "btn-primary" : ""}`} onClick={() => setView("categories")}>
          By category
        </button>
        <button className={`btn ${view === "leaderboard" ? "btn-primary" : ""}`} onClick={() => setView("leaderboard")}>
          All posts
        </button>
        <button className={`btn ${view === "accounts" ? "btn-primary" : ""}`} onClick={() => setView("accounts")}>
          Account totals
        </button>
        <input
          placeholder="Search handle or caption…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        {platformsPresent.length > 1 ? (
          <select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            <option value="all">All platforms</option>
            {platformsPresent.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        ) : null}
        {categoriesPresent.length > 1 ? (
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categoriesPresent.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {filteredPosts.length} / {data.posts.length} posts
        </span>
      </div>

      {data.posts.length === 0 ? (
        <Card>
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>
            No posts tracked yet. Paste a post link above to start.
          </div>
        </Card>
      ) : filteredPosts.length === 0 ? (
        <Card>
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>
            No posts match this filter.
          </div>
        </Card>
      ) : view === "grid" ? (
        // Two levels of grouping: category, then posting account within it. Seeing every
        // account at once is the point — a flat grid with a dropdown makes you filter to
        // compare — and the category band is what lets the operator compare a group of
        // critics against a group of vloggers without doing that arithmetic themselves.
        sections.map((section) => (
          <div key={section.key} style={{ marginBottom: 20 }}>
            <SectionHeader section={section} totals={sectionTotals.get(section.key)} />
            {section.accounts.map((account) => (
              <Card key={account.id} style={{ marginBottom: 16 }}>
                <AccountHeader
                  account={account}
                  campaignId={data.campaign.id}
                  categories={data.categories}
                />
                {account.posts.length === 0 ? (
                  // A subscribed page with nothing counted yet. Saying so beats an empty box,
                  // which reads as the subscription having failed.
                  <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>
                    No campaign posts counted from this page yet.
                  </div>
                ) : (
                  <div className="post-grid" style={{ marginBottom: 0 }}>
                    {account.posts.map((p) => (
                      <PostCard key={p.id} post={p} />
                    ))}
                  </div>
                )}
                <OtherPostsPanel
                  campaignId={data.campaign.id}
                  posts={account.otherPosts}
                  hashtags={data.campaign.hashtags}
                />
              </Card>
            ))}
          </div>
        ))
      ) : view === "categories" ? (
        <CategoryTotalsTable sections={sections} totals={sectionTotals} campaignTotal={t.engagement} />
      ) : view === "leaderboard" ? (
        <Card title="All tracked posts">
          <div className="tbl-scroll">
            <table className="post-tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Platform</th>
                  <th>Posted</th>
                  <th>Type</th>
                  <th>Likes</th>
                  <th>Comments</th>
                  <th>Plays</th>
                  <th>Engagement</th>
                  <th>ER</th>
                  <th>Comment ratio</th>
                  <th>View rate</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredPosts]
                  .sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <a href={p.url} target="_blank" rel="noopener noreferrer">
                          {accountLabel(p.platform, p.accountHandle, labelById.get(p.accountId) ?? null)}
                        </a>
                      </td>
                      <td>{PLATFORM_LABEL[p.platform]}</td>
                      <td>{p.postedAt ? formatIstDate(p.postedAt) : "—"}</td>
                      <td>{p.mediaType ?? "—"}</td>
                      <td><Metric value={p.likes} /></td>
                      <td><Metric value={p.comments} /></td>
                      <td><Metric value={p.views} /></td>
                      <td><strong><Metric value={p.engagement} /></strong></td>
                      <td>{pct(p.engagementRatePct, 2)}</td>
                      <td>{p.commentRatio === null ? "—" : `${(p.commentRatio * 100).toFixed(1)}%`}</td>
                      <td>{p.viewRate === null ? "—" : `${p.viewRate.toFixed(2)}×`}</td>
                      <td><Delta value={p.engagementDelta} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Account totals">
          <div className="tbl-scroll">
            <table className="post-tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  {/* Editable in place. This table is where the operator lands after a page
                      subscription has created ten accounts at once, so filing all ten from
                      one screen has to be possible without opening ten cards. */}
                  <th>Category</th>
                  <th>Platform</th>
                  <th>Followers</th>
                  <th>Posts</th>
                  <th>Likes</th>
                  <th>Comments</th>
                  <th>Plays</th>
                  <th>Engagement</th>
                  <th>Avg / post</th>
                  <th>vs own baseline</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((a) => (
                  <tr key={a.id}>
                    <td>{accountLabel(a.platform, a.handle, a.displayName)}</td>
                    <td>
                      <CategoryPicker
                        campaignId={data.campaign.id}
                        accountId={a.id}
                        categoryId={a.categoryId}
                        categories={data.categories}
                        compact
                      />
                    </td>
                    <td>{PLATFORM_LABEL[a.platform]}</td>
                    <td>{a.followersAvailable ? <Metric value={a.followers} /> : "hidden"}</td>
                    <td>{a.posts.length}</td>
                    <td><Metric value={a.totals.likes} /></td>
                    <td><Metric value={a.totals.comments} /></td>
                    <td><Metric value={a.totals.views} /></td>
                    <td><strong><Metric value={a.totals.engagement} /></strong></td>
                    <td>
                      <Metric
                        value={a.totals.engagement === null ? null : Math.round(a.totals.engagement / a.posts.length)}
                      />
                    </td>
                    <td><BaselineBadge account={a} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
            &ldquo;vs own baseline&rdquo; compares these campaign posts against the account&apos;s own
            average engagement rate as measured by Scoutline, using the same formula on both
            sides. It only appears for accounts that were scanned in Scoutline.
          </div>
        </Card>
      )}
    </>
  );
}

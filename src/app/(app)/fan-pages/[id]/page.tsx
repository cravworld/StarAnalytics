import Link from "next/link";
import { notFound } from "next/navigation";
import { getFanPageDetail } from "@/lib/data/fanpages";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Sparkline } from "@/components/ui/Sparkline";
import { CsvExportRegistrar } from "@/components/shell/CsvExportRegistrar";
import { FanPageActions } from "@/components/fanpages/FanPageActions";
import { platformInk } from "@/lib/palette";

// This page hosts the "Refresh data" Server Action, which on Instagram runs a real Apify
// profile + post-history scrape. Vercel applies the *page's* maxDuration to actions invoked
// from it, so without this the pull is killed at the default limit mid-scrape — same fix,
// same reason, as the agency and hashtag-search screens.
export const maxDuration = 800;

const SENTIMENT_META = {
  pos: { fill: "var(--pencil-green)", text: "var(--pencil-green)", noun: "positive" },
  neu: { fill: "var(--ink-faint)", text: "var(--ink-soft)", noun: "neutral" },
  neg: { fill: "var(--pencil-red)", text: "var(--pencil-red)", noun: "negative" },
} as const;

type SentimentKey = keyof typeof SENTIMENT_META;

/**
 * A three-way sentiment strip.
 *
 * Renders nothing but an honest note when the total is zero: an empty bar with "0%
 * positive / 0% neutral / 0% negative" reads as a measured result rather than an absence
 * of data, which is the exact failure the data-honesty rule in globals.css exists to stop.
 */
function SentimentStrip({
  counts,
  emptyNote,
}: {
  counts: { pos: number; neu: number; neg: number };
  emptyNote: string;
}) {
  const total = counts.pos + counts.neu + counts.neg;
  if (total === 0) {
    return <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>{emptyNote}</div>;
  }
  const keys = Object.keys(SENTIMENT_META) as SentimentKey[];
  return (
    <div style={{ padding: "8px 0" }}>
      <div className="sent-bar" style={{ background: "var(--track)" }}>
        {keys.map((k) => (
          <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: SENTIMENT_META[k].fill }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
        {keys.map((k) => (
          <span key={k} style={{ color: SENTIMENT_META[k].text }}>
            {Math.round((counts[k] / total) * 100)}% {SENTIMENT_META[k].noun}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{total} classified</div>
    </div>
  );
}

/** The unavailable-metric em-dash. Never a zero — see globals.css "DATA HONESTY". */
function NotAvailable({ reason }: { reason: string }) {
  return (
    <span className="na" title={reason}>
      —
    </span>
  );
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

export default async function FanPageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await getFanPageDetail(id);
  if (!page) notFound();

  const { kpis } = page;
  const cadenceMax = Math.max(1, ...page.cadence);
  const campaignMax = Math.max(1, ...page.campaignContribution.map((c) => c.posts));
  const platformLabel = page.platform === "youtube" ? "YouTube" : "Instagram";
  // Instagram never collects reach, so the whole column would be em-dashes on an IG page.
  // Shown only where it can carry a real number (YouTube view counts).
  const showReach = page.platform === "youtube";

  return (
    <>
      <CsvExportRegistrar
        filename={`fan-page-${page.handle}.csv`}
        headers={["Posted", "Type", "Caption", "Likes", "Comments", "Reach", "Engagement", "Campaign", "Sentiment", "URL"]}
        rows={page.posts.map((p) => [
          p.postedLabel ?? "",
          p.mediaType ?? "",
          p.caption,
          p.likes ?? 0,
          p.comments ?? 0,
          p.reach ?? "",
          p.engagement,
          p.campaignName ?? "",
          p.sentimentLabel ?? "",
          p.externalUrl ?? "",
        ])}
      />

      <Link href="/fan-pages" className="back-link">
        ← Back to Fan Pages
      </Link>

      {/* ── Identity header ─────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div
            className="fan-av"
            style={{ background: page.avatar.bg, color: page.avatar.c, width: 52, height: 52, fontSize: 15 }}
          >
            {page.initials}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{page.displayName}</span>
              {page.isVerifiedFan ? <Pill kind="fan">Verified fan</Pill> : null}
              {page.isActive ? null : <Pill kind="warn">Not tracked</Pill>}
            </div>
            <div className="fan-handle" style={{ marginTop: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: platformInk(page.platform), marginRight: 5 }}>
                {platformLabel}
              </span>
              @{page.handle}
            </div>
            <div className="fan-stats" style={{ marginTop: 7 }}>
              <span className="fan-stat">
                <strong>{page.followersDisplay}</strong> followers
                {page.followerTrendDeltaPct !== null ? (
                  <span
                    style={{
                      marginLeft: 4,
                      fontWeight: 700,
                      color: page.followerTrendDeltaPct >= 0 ? "var(--pencil-green)" : "var(--pencil-red)",
                    }}
                  >
                    {page.followerTrendDeltaPct >= 0 ? "+" : ""}
                    {page.followerTrendDeltaPct}%
                  </span>
                ) : null}
              </span>
              <span className="fan-stat">
                <strong>{kpis.postsPerWeek}</strong> {kpis.postsPerWeek === 1 ? "post" : "posts"}/week
              </span>
              <span className="fan-stat">
                <strong>{kpis.campaignPosts}</strong> campaign-linked
              </span>
            </div>
          </div>
          <FanPageActions
            id={page.id}
            platform={page.platform}
            isVerifiedFan={page.isVerifiedFan}
            lastCheckedLabel={page.lastCheckedLabel}
          />
        </div>
      </Card>

      {/* ── Headline metrics ────────────────────────────────────────────────── */}
      <KpiGrid cols={5}>
        <Kpi
          label="Engagement Rate"
          value={kpis.engRate > 0 ? `${kpis.engRate}%` : "—"}
          delta={kpis.engRate > 0 ? "avg engagement ÷ followers" : "needs posts + followers"}
          circled
          note="headline"
        />
        <Kpi label="Tracked Posts" value={String(kpis.totalPosts)} delta={`${kpis.campaignPosts} campaign-linked`} />
        <Kpi label="Avg Likes" value={kpis.avgLikes.toLocaleString()} delta="last 20 posts" />
        <Kpi label="Avg Comments" value={kpis.avgComments.toLocaleString()} delta="last 20 posts" />
        <Kpi label="Total Engagement" value={kpis.totalEngagement.toLocaleString()} delta="likes + comments, all posts" />
      </KpiGrid>

      {/* ── Growth & cadence ────────────────────────────────────────────────── */}
      <div className="g2">
        <Card title="Follower history">
          {page.followerTrend.length >= 2 ? (
            <>
              <Sparkline values={page.followerTrend} width={320} height={64} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                {page.followerTrend.length} snapshots · {page.followerTrend[0].toLocaleString()} →{" "}
                {page.followerTrend[page.followerTrend.length - 1].toLocaleString()}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              {page.followerTrend.length === 1
                ? "One snapshot so far — a trend needs at least two. The next refresh adds one."
                : "No follower snapshots yet. Refresh to record the first."}
            </div>
          )}
        </Card>

        <Card title={`Posting cadence · last ${page.cadenceDays} days`}>
          {page.cadence.some((c) => c > 0) ? (
            <>
              <div className="spark-wrap" style={{ height: 64, gap: 2 }}>
                {page.cadence.map((c, i) => (
                  <div key={i} className="sbar" style={{ height: `${(c / cadenceMax) * 100}%`, opacity: c > 0 ? 1 : 0.15 }} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                {page.cadence.reduce((s, c) => s + c, 0)} posts in {page.cadenceDays} days · peak {cadenceMax} in a day
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              No posts in the last {page.cadenceDays} days.
            </div>
          )}
        </Card>
      </div>

      {/* ── When they post, and what they amplify ───────────────────────────── */}
      <div className="g2">
        <Card title="When they post">
          {page.kpis.totalPosts === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No posts to chart yet.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 3, marginBottom: 5, marginLeft: 38, fontSize: 9, color: "var(--muted)" }}>
                {["00", "04", "08", "12", "16", "20"].map((h) => (
                  <span key={h} style={{ width: 20, textAlign: "center" }}>
                    {h}
                  </span>
                ))}
              </div>
              {page.heatmap.map((row) => (
                <div key={row.day} style={{ display: "flex", gap: 3, marginBottom: 3, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--muted)", width: 34, textAlign: "right" }}>{row.day}</span>
                  {row.slots.map((v, i) => (
                    <div className={`heat-cell h${v}`} key={i} />
                  ))}
                </div>
              ))}
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>
                Local time of the server, from each post&apos;s timestamp.
              </div>
            </>
          )}
        </Card>

        <Card title="Campaigns they amplified">
          {page.campaignContribution.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              None of this page&apos;s tracked posts are linked to a campaign yet.
            </div>
          ) : (
            page.campaignContribution.map((c) => (
              <div className="bar-row" key={c.campaignId}>
                <Link
                  href={`/campaigns/${c.campaignId}`}
                  className="bar-label"
                  style={{ width: 110, textAlign: "left", textDecoration: "none" }}
                  title={c.name}
                >
                  {truncate(c.name, 18)}
                </Link>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.posts / campaignMax) * 100}%` }} />
                </div>
                <span className="bar-val" style={{ width: 68 }}>
                  {c.posts} · {c.engagement.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* ── Sentiment ───────────────────────────────────────────────────────── */}
      <div className="g2">
        <Card title="Sentiment on their posts">
          <SentimentStrip
            counts={page.postSentiment}
            emptyNote="No posts classified yet — classification runs in the background after a refresh."
          />
          {page.postSentiment.unclassified > 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {page.postSentiment.unclassified} post
              {page.postSentiment.unclassified === 1 ? "" : "s"} not classified yet
            </div>
          ) : null}
        </Card>

        <Card title="Sentiment in their comments">
          <SentimentStrip
            counts={page.commentSentiment}
            emptyNote="No comments classified yet for this page's posts."
          />
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {kpis.storedComments.toLocaleString()} comment{kpis.storedComments === 1 ? "" : "s"} stored
          </div>
        </Card>
      </div>

      {/* ── What fans are saying ────────────────────────────────────────────── */}
      <div className="section-title">What fans are saying</div>
      <Card style={{ marginBottom: 16 }}>
        {page.recentComments.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            No comment text available. Comments are scraped as part of sentiment classification, and their text is
            cleared once the retention window passes — older posts keep their counts but not their wording.
          </div>
        ) : (
          page.recentComments.map((c) => (
            <div className="stream-item" key={c.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="stream-handle">{c.authorHandle ? `@${c.authorHandle}` : "commenter"}</span>
                  {c.sentimentLabel ? (
                    <span style={{ fontSize: 10, color: SENTIMENT_META[c.sentimentLabel].text }}>
                      {SENTIMENT_META[c.sentimentLabel].noun}
                    </span>
                  ) : null}
                  <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>{c.postedLabel}</span>
                </div>
                <div className="stream-text" style={{ marginTop: 3 }}>
                  {truncate(c.text, 240)}
                </div>
              </div>
            </div>
          ))
        )}
      </Card>

      {/* ── Top posts ───────────────────────────────────────────────────────── */}
      <div className="section-title">Top posts by engagement</div>
      <Card style={{ marginBottom: 16 }}>
        {page.topPosts.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            No posts tracked for this page yet. Use Refresh data to pull its recent posts.
          </div>
        ) : (
          page.topPosts.map((p, i) => (
            <div className="lb-row" key={p.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule)" }}>
              <div className={`lb-rank${i < 3 ? ` r${i + 1}` : ""}`}>{i + 1}</div>
              <div className="lb-body">
                <div className="lb-name">
                  {p.externalUrl ? (
                    <a href={p.externalUrl} target="_blank" rel="noopener noreferrer">
                      {truncate(p.caption || "(no caption)", 70)}
                    </a>
                  ) : (
                    truncate(p.caption || "(no caption)", 70)
                  )}
                </div>
                <div className="lb-meta">
                  <span>{p.postedLabel ?? "undated"}</span>
                  <span>{(p.likes ?? 0).toLocaleString()} likes</span>
                  <span>{(p.comments ?? 0).toLocaleString()} comments</span>
                  {p.campaignName ? <span>#{truncate(p.campaignName, 22)}</span> : null}
                </div>
              </div>
              <div className="lb-score">{p.engagement.toLocaleString()}</div>
            </div>
          ))
        )}
      </Card>

      {/* ── Every tracked post ──────────────────────────────────────────────── */}
      <div className="section-title">All tracked posts ({page.posts.length})</div>
      <Card>
        {page.posts.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing stored for this page yet.</div>
        ) : (
          <div className="tbl-scroll">
            <table className="post-tbl">
              <thead>
                <tr>
                  <th>Posted</th>
                  <th>Type</th>
                  <th>Caption</th>
                  <th style={{ textAlign: "right" }}>Likes</th>
                  <th style={{ textAlign: "right" }}>Comments</th>
                  {showReach ? <th style={{ textAlign: "right" }}>Views</th> : null}
                  <th style={{ textAlign: "right" }}>Engagement</th>
                  <th>Campaign</th>
                  <th>Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {page.posts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{p.postedLabel ?? <NotAvailable reason="No timestamp on this post" />}</td>
                    <td>{p.mediaType ?? <NotAvailable reason="Media type not recorded" />}</td>
                    <td style={{ maxWidth: 320 }}>
                      {p.externalUrl ? (
                        <a href={p.externalUrl} target="_blank" rel="noopener noreferrer">
                          {truncate(p.caption || "(no caption)", 80)}
                        </a>
                      ) : (
                        truncate(p.caption || "(no caption)", 80)
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{(p.likes ?? 0).toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{(p.comments ?? 0).toLocaleString()}</td>
                    {showReach ? (
                      <td style={{ textAlign: "right" }}>
                        {p.reach !== null ? p.reach.toLocaleString() : <NotAvailable reason="No view count for this video" />}
                      </td>
                    ) : null}
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{p.engagement.toLocaleString()}</td>
                    <td>{p.campaignName ? truncate(p.campaignName, 20) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>
                      {p.sentimentLabel ? (
                        <span style={{ color: SENTIMENT_META[p.sentimentLabel].text }}>
                          {SENTIMENT_META[p.sentimentLabel].noun}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Alerts ──────────────────────────────────────────────────────────── */}
      <div className="section-title">Alerts for this page</div>
      {page.alerts.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
          No alerts for this page yet.
        </div>
      ) : (
        page.alerts.map((a) => (
          <div className="alert-item" key={a.id}>
            <span style={{ opacity: a.delivered ? 0.5 : 1 }}>🔔</span>
            <div style={{ flex: 1 }}>
              <span>{a.message}</span>
              {a.delivered ? (
                <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: 6 }}>
                  delivered{a.channel ? ` · ${a.channel}` : ""}
                </span>
              ) : (
                <span style={{ color: "var(--pencil-amber)", fontSize: 10, marginLeft: 6 }}>not delivered</span>
              )}
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{a.time}</span>
          </div>
        ))
      )}
    </>
  );
}

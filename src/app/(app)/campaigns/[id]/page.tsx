import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignDetail } from "@/lib/data/campaigns";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Pill, LiveDot } from "@/components/ui/Pill";
import { LiveStream } from "@/components/campaigns/LiveStream";
import { SentimentBar } from "@/components/campaigns/SentimentBar";
import { SentimentTrendLine } from "@/components/charts/SentimentTrendLine";
import { CampaignTimeline } from "@/components/campaigns/CampaignTimeline";
import { CsvExportRegistrar } from "@/components/shell/CsvExportRegistrar";
import { Sparkline } from "@/components/ui/Sparkline";

// Green/yellow/red bands so the number reads at a glance without needing the tooltip.
function bandColor(score: number): string {
  if (score >= 70) return "#1a7a4a";
  if (score >= 40) return "#e6a700";
  return "#c62828";
}

function BuzzScoreBadge({
  score,
  components,
}: {
  score: number;
  components: { size: number; sentiment: number | null; momentum: number };
}) {
  const color = bandColor(score);
  const title = `Buzz score components — Size ${components.size} · Sentiment ${components.sentiment ?? "not classified yet"} · Momentum ${components.momentum}`;
  return (
    <div
      title={title}
      style={{
        width: 64,
        height: 64,
        borderRadius: "50%",
        border: `3px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "default",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 2 }}>BUZZ</div>
    </div>
  );
}

// Nothing to trend on fewer than 2 snapshots — first day after this feature ships (or any
// campaign younger than the daily cron's history) renders nothing here rather than a
// single meaningless dot. weekAgoDelta is separately null until a snapshot >=5 days old
// exists — see getBuzzWeekAgoDelta's own comment.
function BuzzTrendMini({ values, weekAgoDelta }: { values: number[]; weekAgoDelta: number | null }) {
  if (values.length < 2) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 4 }}>
      <Sparkline values={values} width={64} height={14} />
      {weekAgoDelta !== null ? (
        <span style={{ fontSize: 10, fontWeight: 700, color: weekAgoDelta >= 0 ? "#1a7a4a" : "#c62828" }}>
          {weekAgoDelta >= 0 ? "+" : ""}
          {weekAgoDelta}
        </span>
      ) : null}
    </div>
  );
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getCampaignDetail(id);
  if (!v) notFound();

  const maxVolume = Math.max(1, ...v.hourlyVolume);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/campaigns" className="back-link">
          ← Back to Campaigns
        </Link>
        <Link href={`/campaigns/${v.id}/media-kit`} className="tb-btn">
          Media Kit ↗
        </Link>
      </div>

      <div className="vhero">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div>
            <BuzzScoreBadge score={v.buzzScore.score} components={v.buzzScore.components} />
            <BuzzTrendMini values={v.buzzTrend.values} weekAgoDelta={v.buzzWeekAgoDelta} />
          </div>
          <div>
            <div className="vhero-tag">{v.tag || "(no hashtags set)"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{v.startedLabel}</div>
            <div style={{ marginTop: 8 }}>
              <Pill kind="live">
                <LiveDot /> Live tracking
              </Pill>
            </div>
          </div>
        </div>
        <div className="vhero-stats">
          <div className="vstat">
            <div className="vstat-val">{v.hero.postsToday}</div>
            <div className="vstat-label">Posts today</div>
          </div>
          <div className="divider" />
          <div className="vstat">
            <div className="vstat-val" style={{ color: "var(--accent)" }}>
              {v.hero.lastHour}
            </div>
            <div className="vstat-label">Last hour</div>
          </div>
          <div className="divider" />
          <div className="vstat">
            <div className="vstat-val">{v.hero.engagement}</div>
            <div className="vstat-label">Engagement (likes+comments)</div>
          </div>
          <div className="divider" />
          <div className="vstat">
            <div className="vstat-val">{v.hero.uniqueAccounts}</div>
            <div className="vstat-label">Unique accounts</div>
          </div>
        </div>
      </div>

      <KpiGrid cols={4}>
        {v.kpis.map((k) => (
          <Kpi key={k.label} label={k.label} value={k.pending ? "Pending" : k.value} delta={k.delta} />
        ))}
      </KpiGrid>

      <div className="g2">
        <Card title="Post Volume (Hourly)">
          <div className="spark-wrap">
            {v.hourlyVolume.map((val, i) => {
              const pct = (val / maxVolume) * 100;
              return <div className={`sbar${pct >= 90 ? " hi" : ""}`} style={{ height: `${pct}%` }} key={i} />;
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Tracking start</span>
            <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{v.peakLabel}</span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Now</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="card-title">Sentiment</div>
            <SentimentBar sentiment={v.sentiment} items={v.sentimentItems} />
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title="Geographic Spread">
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              Pending — {v.geoSpreadPending.reason}
            </div>
          </Card>
          <Card title="Top Keywords">
            {v.keywordPills.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 0" }}>
                {v.keywordPills.map((kw) => (
                  <Pill key={kw}>{kw}</Pill>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
                {v.sentiment
                  ? "No keywords extracted yet for classified posts."
                  : "Keyword extraction pending — no posts classified yet."}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title="Campaign Timeline">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
          Log trailer drops, premieres, and release dates to see them against sentiment below.
        </div>
        <CampaignTimeline campaignId={v.id} events={v.events} />
      </Card>

      <Card title="Sentiment Over Time">
        {v.sentimentTrend.length >= 2 ? (
          <SentimentTrendLine data={v.sentimentTrend} events={v.events} />
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
            {v.sentimentTrend.length === 0
              ? "No classified posts yet — a trend needs at least two days with classified posts."
              : "Only one day of classified posts so far — a trend needs at least two."}
          </div>
        )}
      </Card>

      {v.hashtagBreakdown.length > 0 ? (
        <Card title="Hashtag Performance">
          <CsvExportRegistrar
            filename={`${v.name}-hashtag-performance.csv`}
            headers={["Hashtag", "Posts", "Total Engagement", "Avg Engagement/Post"]}
            rows={v.hashtagBreakdown.map((h) => [`#${h.hashtag}`, h.postCount, h.totalEngagement, h.avgEngagementPerPost])}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Ranked by total engagement — a post can carry more than one tracked tag, so totals can overlap.
          </div>
          {(() => {
            const maxEng = Math.max(1, ...v.hashtagBreakdown.map((h) => h.totalEngagement));
            return v.hashtagBreakdown.map((h) => (
              <div className="bar-row" key={h.hashtag}>
                <div className="bar-label">#{h.hashtag}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(h.totalEngagement / maxEng) * 100}%` }} />
                </div>
                <div className="bar-val">
                  {h.postCount} post{h.postCount === 1 ? "" : "s"} · {h.totalEngagement.toLocaleString()} eng
                </div>
              </div>
            ));
          })()}
        </Card>
      ) : null}

      {v.contentTypeBreakdown.length > 0 ? (
        <Card title="Content Type Performance">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Ranked by average engagement per post — which format is actually working, not just which was posted most.
          </div>
          {(() => {
            const maxAvg = Math.max(1, ...v.contentTypeBreakdown.map((c) => c.avgEngagementPerPost));
            return v.contentTypeBreakdown.map((c) => (
              <div className="bar-row" key={c.mediaType}>
                <div className="bar-label">{c.mediaType}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.avgEngagementPerPost / maxAvg) * 100}%` }} />
                </div>
                <div className="bar-val">
                  {c.postCount} post{c.postCount === 1 ? "" : "s"} · {c.avgEngagementPerPost.toLocaleString()} avg eng
                </div>
              </div>
            ));
          })()}
        </Card>
      ) : null}

      {v.mentionBreakdown.length > 0 ? (
        <Card title="Mentions">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Who gets tagged most often across tracked posts — a co-star/collaborator leaderboard, not new posts
            beyond what's already tracked here.
          </div>
          {(() => {
            const maxCount = Math.max(1, ...v.mentionBreakdown.map((m) => m.postCount));
            return v.mentionBreakdown.map((m) => (
              <div className="bar-row" key={m.handle}>
                <a href={`https://www.instagram.com/${m.handle}`} target="_blank" rel="noopener noreferrer" className="bar-label">
                  @{m.handle}
                </a>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(m.postCount / maxCount) * 100}%` }} />
                </div>
                <div className="bar-val">
                  {m.postCount} post{m.postCount === 1 ? "" : "s"} · {m.totalEngagement.toLocaleString()} eng
                </div>
              </div>
            ));
          })()}
        </Card>
      ) : null}

      {v.hashtagSuggestions.length > 0 ? (
        <Card title="Suggested Hashtags">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Untracked hashtags that frequently appear alongside this campaign's own tags in posts already
            scraped — worth considering for a future campaign or a wider hashtag search. Not automatically
            tracked.
          </div>
          {(() => {
            const maxCount = Math.max(1, ...v.hashtagSuggestions.map((s) => s.coOccurrenceCount));
            return v.hashtagSuggestions.map((s) => (
              <div className="bar-row" key={s.hashtag}>
                <div className="bar-label">#{s.hashtag}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(s.coOccurrenceCount / maxCount) * 100}%` }} />
                </div>
                <div className="bar-val">
                  {s.coOccurrenceCount} co-occurrence{s.coOccurrenceCount === 1 ? "" : "s"}
                </div>
              </div>
            ));
          })()}
        </Card>
      ) : null}

      <Card title="Live Post Stream">
        <LiveStream campaignId={v.id} initial={v.stream} />
      </Card>
    </>
  );
}

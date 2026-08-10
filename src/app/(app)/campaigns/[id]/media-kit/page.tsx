import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignDetail } from "@/lib/data/campaigns";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { SentimentBar } from "@/components/campaigns/SentimentBar";
import { MediaKitPrintButton } from "@/components/campaigns/MediaKitPrintButton";

// Print-to-PDF one-pager for a single campaign — the artifact a talent team sends to a
// brand, journalist, or studio partner. Reuses getCampaignDetail() entirely (buzz score,
// sentiment, hashtag breakdown, topPosts) rather than a second query — same discipline as
// getCampaignCompareData in campaigns.ts. Zero new Apify/Claude cost: every number here was
// already computed for the campaign detail page.
export default async function CampaignMediaKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getCampaignDetail(id);
  if (!v) notFound();

  const generatedOn = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const maxHashtagEng = Math.max(1, ...v.hashtagBreakdown.map((h) => h.totalEngagement));

  return (
    <div className="media-kit">
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Link href={`/campaigns/${v.id}`} className="back-link">
          ← Back to {v.name}
        </Link>
        <MediaKitPrintButton />
      </div>

      <div className="mk-header">
        <div>
          <div className="mk-title">{v.name}</div>
          <div className="mk-tag">{v.tag || "(no hashtags set)"}</div>
        </div>
        <div className="mk-generated">Media Kit · Generated {generatedOn}</div>
      </div>

      <KpiGrid cols={4}>
        <Kpi label="Buzz Score" value={String(v.buzzScore.score)} />
        <Kpi label="Total Engagement" value={v.hero.engagement} />
        <Kpi
          label="Sentiment"
          value={v.sentiment ? `${v.sentiment.positivePct}% positive` : "Pending"}
          delta={v.sentiment ? `${v.sentiment.classifiedCount}/${v.sentiment.totalCount} classified` : undefined}
        />
        <Kpi label="Posts Tracked" value={String(v.postCount)} />
      </KpiGrid>

      {v.events.length > 0 ? (
        <Card title="Key Dates">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {v.events.map((e) => (
              <div key={e.id} style={{ fontSize: 12 }}>
                <strong>{e.eventDateLabel}</strong> — {e.label}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Sentiment">
        <SentimentBar sentiment={v.sentiment} items={v.sentimentItems} />
      </Card>

      {v.hashtagBreakdown.length > 0 ? (
        <Card title="Hashtag Performance">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Ranked by total engagement — a post can carry more than one tracked tag, so totals can overlap.
          </div>
          {v.hashtagBreakdown.map((h) => (
            <div className="bar-row" key={h.hashtag}>
              <div className="bar-label">#{h.hashtag}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(h.totalEngagement / maxHashtagEng) * 100}%` }} />
              </div>
              <div className="bar-val">
                {h.postCount} post{h.postCount === 1 ? "" : "s"} · {h.totalEngagement.toLocaleString()} eng
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <Card title={`Top Posts (by engagement, top ${v.topPosts.length})`}>
        {v.topPosts.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No posts tracked yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {v.topPosts.map((p, i) => (
              <div key={p.id} className="mk-post-row">
                <div className="mk-post-rank">#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    {p.externalUrl ? (
                      <a href={p.externalUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                        {p.handle}
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{p.handle}</span>
                    )}
                    <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                      {p.likes.toLocaleString()} likes · {p.comments.toLocaleString()} comments
                    </span>
                  </div>
                  {p.caption && (
                    <div style={{ color: "var(--muted)", marginTop: 2, fontSize: 12 }}>
                      {p.caption.length > 160 ? `${p.caption.slice(0, 160)}…` : p.caption}
                    </div>
                  )}
                  <div style={{ color: "var(--muted)", marginTop: 2, fontSize: 11 }}>
                    {p.postedAtLabel ?? "Date unknown"}
                    {p.mediaType ? ` · ${p.mediaType}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mk-footer">
        Engagement = likes + comments from public post scrapes; true reach/impressions are not available for
        non-owned accounts. Generated by StarAnalytics on {generatedOn}.
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignDetail } from "@/lib/data/campaigns";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Pill, LiveDot } from "@/components/ui/Pill";
import { LiveStream } from "@/components/campaigns/LiveStream";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getCampaignDetail(id);
  if (!v) notFound();

  const maxVolume = Math.max(1, ...v.hourlyVolume);

  return (
    <>
      <Link href="/campaigns" className="back-link">
        ← Back to Campaigns
      </Link>

      <div className="vhero">
        <div>
          <div className="vhero-tag">{v.tag || "(no hashtags set)"}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{v.startedLabel}</div>
          <div style={{ marginTop: 8 }}>
            <Pill kind="live">
              <LiveDot /> Live tracking
            </Pill>
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
            <span style={{ fontSize: 10, color: "var(--faint)" }}>Tracking start</span>
            <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{v.peakLabel}</span>
            <span style={{ fontSize: 10, color: "var(--faint)" }}>Now</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="card-title">Sentiment</div>
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              Sentiment analysis pending — lands in Phase 4 (LLM classification pass).
            </div>
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title="Geographic Spread">
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              Pending — {v.geoSpreadPending.reason}
            </div>
          </Card>
          <Card title="Top Keywords">
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
              Keyword extraction pending — lands in Phase 4 (LLM classification pass).
            </div>
          </Card>
        </div>
      </div>

      <Card title="Live Post Stream">
        <LiveStream campaignId={v.id} initial={v.stream} />
      </Card>
    </>
  );
}

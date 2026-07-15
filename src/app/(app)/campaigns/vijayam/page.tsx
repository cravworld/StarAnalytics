import Link from "next/link";
import { getVijayamDetail } from "@/lib/data/campaigns";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Pill, LiveDot } from "@/components/ui/Pill";

export default async function VijayamDetailPage() {
  const v = await getVijayamDetail();
  const maxVolume = Math.max(...v.hourlyVolume);

  return (
    <>
      <Link href="/campaigns" className="back-link">
        ← Back to Campaigns
      </Link>

      <div className="vhero">
        <div>
          <div className="vhero-tag">{v.tag}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{v.startedLabel}</div>
          <div style={{ marginTop: 8 }}>
            <Pill kind="live"><LiveDot /> Live tracking</Pill>
          </div>
        </div>
        <div className="vhero-stats">
          <div className="vstat">
            <div className="vstat-val">{v.hero.postsToday}</div>
            <div className="vstat-label">Posts today</div>
          </div>
          <div className="divider" />
          <div className="vstat">
            <div className="vstat-val" style={{ color: "var(--accent)" }}>{v.hero.lastHour}</div>
            <div className="vstat-label">Last hour</div>
          </div>
          <div className="divider" />
          <div className="vstat">
            <div className="vstat-val">{v.hero.totalReach}</div>
            <div className="vstat-label">Total reach</div>
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
          <Kpi key={k.label} label={k.label} value={k.value} delta={k.delta} deltaDirection={k.delta === "Above avg" || k.delta === "Positive" || k.delta === "Fast spreading" ? "up" : undefined} />
        ))}
      </KpiGrid>

      <div className="g2">
        <Card title="Post Volume Since Announcement (Hourly)">
          <div className="spark-wrap">
            {v.hourlyVolume.map((val, i) => {
              const pct = (val / maxVolume) * 100;
              return <div className={`sbar${pct >= 90 ? " hi" : ""}`} style={{ height: `${pct}%` }} key={i} />;
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "var(--faint)" }}>Announcement</span>
            <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{v.peakLabel}</span>
            <span style={{ fontSize: 10, color: "var(--faint)" }}>Now</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="card-title">Sentiment</div>
            <div className="sent-bar">
              <div style={{ width: `${v.sentiment.positive}%`, background: "var(--green)" }} />
              <div style={{ width: `${v.sentiment.neutral}%`, background: "#999" }} />
              <div style={{ width: `${v.sentiment.negative}%`, background: "var(--red)" }} />
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--green)", display: "inline-block" }} />
                Positive {v.sentiment.positive}%
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#999", display: "inline-block" }} />
                Neutral {v.sentiment.neutral}%
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--red)", display: "inline-block" }} />
                Negative {v.sentiment.negative}%
              </span>
            </div>
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title="Geographic Spread">
            {v.geoSpread.map((g) => (
              <div className="geo-row" key={g.name}>
                <div className="geo-name">{g.name}</div>
                <div className="geo-track">
                  <div className="geo-fill" style={{ width: `${(g.pct / v.geoSpread[0].pct) * 100}%` }} />
                </div>
                <div className="geo-val">{g.pct}%</div>
              </div>
            ))}
          </Card>
          <Card title="Top Keywords">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {v.keywords.map((k) => (
                <Pill key={k.text} kind={k.hot ? "hot" : "default"}>{k.text}</Pill>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Live Post Stream">
        {v.stream.map((s, i) => (
          <div className="stream-item" key={i}>
            <div className="stream-av" style={{ background: s.bg, color: s.c }}>{s.av}</div>
            <div className="stream-body">
              <span className="stream-handle">{s.handle}</span>
              <span className="stream-time">{s.time}</span>
              <div className="stream-text">{s.text}</div>
              <div className="stream-stats">
                <span className="sst">♥ {s.likes}</span>
                <span className="sst">💬 {s.comments}</span>
                <Pill kind={s.tag === "Fan page" ? "fan" : "default"}>{s.tag}</Pill>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

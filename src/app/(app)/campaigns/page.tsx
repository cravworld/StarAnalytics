import Link from "next/link";
import { getOwnCampaigns } from "@/lib/data/campaigns";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Pill, LiveDot } from "@/components/ui/Pill";

export default async function OwnCampaignsPage() {
  const { campaigns, kpis } = await getOwnCampaigns();

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input placeholder="Search campaigns…" style={{ flex: 1 }} />
        <button className="btn btn-primary">＋ New Campaign</button>
      </div>

      <KpiGrid cols={3}>
        <Kpi label="Active Campaigns" value={String(kpis.active)} delta="1 new this week" deltaDirection="up" />
        <Kpi label="Total Hashtag Reach" value={kpis.totalHashtagReach} delta="All campaigns" />
        <Kpi label="Hashtags Tracked" value={String(kpis.hashtagsTracked)} delta="Across campaigns" />
      </KpiGrid>

      {campaigns.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          No campaigns yet.
        </div>
      ) : (
        campaigns.map((c) =>
          c.id === "vijayam" ? (
            <Link
              href="/campaigns/vijayam"
              className={`campaign-card${c.featured ? " featured" : ""}`}
              key={c.id}
            >
              <div className="camp-icon" style={{ background: c.iconBg }}>{c.icon}</div>
              <div className="camp-body">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <div className="camp-name">{c.name}</div>
                  <Pill kind="live"><LiveDot /> Live</Pill>
                </div>
                <div className="camp-meta">{c.meta}</div>
                <div className="camp-stats">
                  {c.stats.map((s) => (
                    <span className="cstat" key={s.label}>
                      <strong>{s.value}</strong> {s.label}
                    </span>
                  ))}
                </div>
              </div>
              <span style={{ color: "var(--faint)", fontSize: 18, marginTop: 2 }}>›</span>
            </Link>
          ) : (
            <div className="campaign-card" key={c.id}>
              <div className="camp-icon" style={{ background: c.iconBg }}>{c.icon}</div>
              <div className="camp-body">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <div className="camp-name">{c.name}</div>
                  {c.status === "live" ? (
                    <Pill kind="live"><LiveDot /> Live</Pill>
                  ) : (
                    <Pill kind="planned">Planned</Pill>
                  )}
                </div>
                <div className="camp-meta">{c.meta}</div>
                {c.stats.length > 0 ? (
                  <div className="camp-stats">
                    {c.stats.map((s) => (
                      <span className="cstat" key={s.label}>
                        <strong>{s.value}</strong> {s.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <span style={{ color: "var(--faint)", fontSize: 18, marginTop: 2 }}>›</span>
            </div>
          ),
        )
      )}
    </>
  );
}

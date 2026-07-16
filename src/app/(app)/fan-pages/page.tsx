import { getFanPagesData } from "@/lib/data/fanpages";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { AddFanPageForm, PromoteSuggestionButton } from "@/components/fanpages/AddFanPageForm";
import { FanPageList } from "@/components/fanpages/FanPageList";

export default async function FanPagesPage() {
  const { fanPages, totalTracked, kpis, alerts, suggestions } = await getFanPagesData();

  return (
    <>
      <KpiGrid cols={3}>
        <Kpi label="Total Fan Reach" value={kpis.totalReach} delta="Combined followers" />
        <Kpi label="Active Today" value={kpis.activeToday} delta="posted in last 24h" />
        <Kpi label="Posting Campaign Tags" value={kpis.postingCampaignTags} delta="linked to a live campaign" />
      </KpiGrid>

      <AddFanPageForm />

      {suggestions.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Suggested Fan Pages</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Repeat posters of your tracked campaign hashtags, not yet tracked as fan pages.
          </div>
          {suggestions.map((s) => (
            <div
              key={s.handle}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>@{s.handle}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.postCount} posts under tracked campaigns</div>
              </div>
              <PromoteSuggestionButton handle={s.handle} />
            </div>
          ))}
        </div>
      ) : null}

      <FanPageList fanPages={fanPages} />

      <div className="section-title">Alerts</div>
      {alerts.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
          No alerts yet.
        </div>
      ) : (
        alerts.map((a, i) => (
          <div className="alert-item" key={i}>
            <span style={{ opacity: a.dim ? 0.5 : 1 }}>{a.icon}</span>
            <div style={{ flex: 1 }}>
              {a.prefix ? <span style={{ color: "var(--muted)" }}>{a.prefix}</span> : null}
              <span style={{ fontWeight: 700 }}>{a.bold}</span>
              <span style={{ color: "var(--muted)" }}>{a.text}</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>{a.time}</span>
          </div>
        ))
      )}
    </>
  );
}

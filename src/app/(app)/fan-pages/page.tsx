import { getFanPagesData } from "@/lib/data/fanpages";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { AddFanPageForm, PromoteSuggestionButton } from "@/components/fanpages/AddFanPageForm";
import { BulkAddFanPagesForm } from "@/components/fanpages/BulkAddFanPagesForm";
import { FanPageList } from "@/components/fanpages/FanPageList";
import { RefreshAllFanPagesButton } from "@/components/fanpages/RefreshAllFanPagesButton";

// Adding a fan page (and promoting a suggestion) now runs a full profile + post-history
// scrape rather than the old profile-only call, which does not fit in the default action
// timeout. Vercel applies the hosting page's maxDuration to its Server Actions — same fix
// as the agency and hashtag-search screens.
export const maxDuration = 800;

export default async function FanPagesPage() {
  const { fanPages, totalTracked, kpis, alerts, suggestions } = await getFanPagesData();

  return (
    <>
      <KpiGrid cols={3}>
        {/* What the whole screen exists to answer: how big is the fan network. */}
        <Kpi label="Total Fan Reach" value={kpis.totalReach} delta="Combined followers" circled note="headline" />
        <Kpi label="Active Today" value={kpis.activeToday} delta="posted in last 24h" />
        <Kpi label="Posting Campaign Tags" value={kpis.postingCampaignTags} delta="linked to a live campaign" />
      </KpiGrid>

      <AddFanPageForm />

      {/* Collapsed by default: adding one page stays the one-line path it always was, and the
          paste-a-list box only unfolds for the batch case rather than doubling the height of
          the screen's first control for everyone. */}
      <BulkAddFanPagesForm />

      {/* Sits directly above the list it acts on, right-aligned so it reads as a control for
          the whole list rather than another field on the add form above it. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <RefreshAllFanPagesButton totalTracked={totalTracked} />
      </div>

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
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{a.time}</span>
          </div>
        ))
      )}
    </>
  );
}

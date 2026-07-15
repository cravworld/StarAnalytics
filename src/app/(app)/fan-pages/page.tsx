import { getFanPagesData } from "@/lib/data/fanpages";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";

export default async function FanPagesPage() {
  const { fanPages, kpis, alerts } = await getFanPagesData();

  return (
    <>
      <KpiGrid cols={3}>
        <Kpi label="Total Fan Reach" value={kpis.totalReach} delta="Combined followers" />
        <Kpi label="Active Today" value={kpis.activeToday} delta="75% posting rate" deltaDirection="up" />
        <Kpi label="Posting #vijayam" value={kpis.postingVijayam} delta="87% coverage" deltaDirection="up" />
      </KpiGrid>

      <div className="add-btn">＋ Add fan page to track</div>

      <div className="inner-tabs">
        <button className="itab active">All ({fanPages.length})</button>
        <button className="itab">Most Active</button>
        <button className="itab">Posting #vijayam</button>
        <button className="itab">Largest Reach</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {fanPages.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>No fan pages tracked yet.</div>
        ) : (
          fanPages.map((f) => {
            const maxSpark = Math.max(...f.spark);
            return (
              <div className="fan-row" key={f.handle}>
                <div className="fan-av" style={{ background: f.bg, color: f.c }}>{f.init}</div>
                <div className="fan-info">
                  <div className="fan-name">
                    {f.name} {f.init === "NF" ? <Pill kind="fan">Verified fan</Pill> : null}
                  </div>
                  <div className="fan-handle">{f.handle}</div>
                  <div className="fan-stats">
                    <span className="fan-stat"><strong>{f.followers}</strong> followers</span>
                    <span className="fan-stat"><strong>{f.eng}</strong> eng</span>
                    <span className="fan-stat"><strong>{f.posts}</strong> today</span>
                  </div>
                </div>
                <div className="fan-right">
                  <div className="mini-spark">
                    {f.spark.map((v, i) => (
                      <div
                        className={`ms-bar${v >= maxSpark ? " mhi" : ""}`}
                        style={{ height: `${v}%` }}
                        key={i}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div className={`sdot ${f.status ? "sdot-on" : "sdot-off"}`} />
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{f.status ? "Active now" : "Idle"}</span>
                  </div>
                  {f.vijayam ? (
                    <span className="pill pill-hot" style={{ fontSize: 10 }}>#vijayam</span>
                  ) : (
                    <span className="pill" style={{ fontSize: 10 }}>Not yet</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

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

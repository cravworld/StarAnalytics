import { getCompareData } from "@/lib/data/compare";

// getCompareData() runs a real, slow (10-20s+) Apify scrape when
// DATA_MODE_APIFY=live — force-dynamic keeps that off the build's static
// generation pass (where it timed out) and defers it to request time.
export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const { self, other, metrics } = await getCompareData();

  return (
    <>
      <div className="add-btn">＋ Add account to compare</div>
      <div className="cmp-grid">
        <div />
        <div className="cmp-header">
          <div className="avatar" style={{ margin: "0 auto 6px" }}>NP</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{self.name}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {self.handle} · {self.followers}
          </div>
        </div>
        <div className="cmp-header" style={{ background: "#f0f4ff" }}>
          <div className="avatar" style={{ margin: "0 auto 6px", background: "#e3f2fd", color: "var(--blue)" }}>DQ</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{other.name}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {other.handle} · {other.followers}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {metrics.map((m, i) => (
          <div
            className="cmp-row"
            style={{ padding: "9px 14px", borderBottom: i === metrics.length - 1 ? "none" : undefined }}
            key={m.label}
          >
            <div className="cmp-label">{m.label}</div>
            <div className="cmp-cell">
              <div className={`cmp-val${!m.otherWins ? " win" : ""}`}>{m.self}</div>
              <div className="cmp-bar-wrap">
                <div style={{ width: `${m.selfPct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
              </div>
            </div>
            <div className="cmp-cell">
              {m.otherPrivate ? (
                <div className="cmp-val" title="Story Response Rate is a Graph API insight only available for Nivin's own account — never for another user's page.">
                  —
                </div>
              ) : (
                <>
                  <div className={`cmp-val${m.otherWins ? " win" : ""}`}>{m.other}</div>
                  <div className="cmp-bar-wrap">
                    <div style={{ width: `${m.otherPct}%`, height: "100%", background: "var(--blue)", borderRadius: 2 }} />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

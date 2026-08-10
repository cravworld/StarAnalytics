import { getCompareData } from "@/lib/data/compare";
import { isInstagramInsightsLive } from "@/lib/providers";
import { AddCompetitorForm, RemoveCompetitorButton } from "@/components/compare/AddCompetitorForm";
import { Sparkline } from "@/components/ui/Sparkline";
import { PendingMetaReviewBadge } from "@/components/ui/PendingMetaReview";
import { CsvExportRegistrar } from "@/components/shell/CsvExportRegistrar";

// Nothing meaningful to show until an account has been scraped at least twice — a single
// point isn't a trend. Self never has any (Phase 7 self-account pipeline has never gone
// live, see compare.ts's selfColumn), so this silently renders nothing for that column.
function FollowerTrendMini({ trend, deltaPct }: { trend: number[]; deltaPct: number | null }) {
  if (trend.length < 2) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
      <Sparkline values={trend} width={60} height={16} />
      {deltaPct !== null ? (
        <span style={{ fontSize: 10, fontWeight: 700, color: deltaPct >= 0 ? "#1a7a4a" : "#c62828" }}>
          {deltaPct >= 0 ? "+" : ""}
          {deltaPct}%
        </span>
      ) : null}
    </div>
  );
}

// getCompareData() now only ever reads competitor_accounts/posts — the real Apify
// scrape (slow, 10-20s+) happens from the add-competitor action or the polling cron,
// never from render. force-dynamic was here to keep that slow scrape off the static
// build pass; with the scrape gone from this path, this page behaves like every other
// real-data screen in the app (fan-pages, campaigns) and needs no special directive.

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default async function ComparePage() {
  const { columns, rows } = await getCompareData();
  const gridCols = `160px repeat(${columns.length}, 1fr)`;
  const selfIsLive = isInstagramInsightsLive();

  return (
    <>
      <CsvExportRegistrar
        filename="compare.csv"
        headers={["Metric", ...columns.map((c) => c.displayName)]}
        rows={rows.map((row) => [row.label, ...row.cells.map((c) => c.display)])}
      />
      <AddCompetitorForm />

      <div style={{ overflowX: "auto" }}>
        <div className="cmp-grid" style={{ gridTemplateColumns: gridCols, minWidth: 160 + columns.length * 140 }}>
          <div />
          {columns.map((col, i) => (
            <div
              key={col.id}
              className="cmp-header"
              style={{ position: "relative", background: i === 0 ? undefined : "#f0f4ff" }}
            >
              {i > 0 ? <RemoveCompetitorButton id={col.id} /> : null}
              {i === 0 && !selfIsLive ? (
                <div style={{ position: "absolute", top: 6, left: 6 }}>
                  <PendingMetaReviewBadge />
                </div>
              ) : null}
              <div className="avatar" style={{ margin: "0 auto 6px", background: i === 0 ? undefined : "#e3f2fd", color: i === 0 ? undefined : "var(--blue)" }}>
                {initialsFor(col.displayName)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{col.displayName}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: col.platform === "youtube" ? "#c4302b" : "#E1306C",
                    marginRight: 4,
                  }}
                >
                  {col.platform === "youtube" ? "YT" : "IG"}
                </span>
                {col.handle} · {col.followersDisplay}
              </div>
              {col.lastUpdatedLabel ? (
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Last updated {col.lastUpdatedLabel}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 0, minWidth: 160 + columns.length * 140 }}>
          {rows.map((row, i) => (
            <div
              className="cmp-row"
              style={{ gridTemplateColumns: gridCols, padding: "9px 14px", borderBottom: i === rows.length - 1 ? "none" : undefined }}
              key={row.key}
            >
              <div className="cmp-label">{row.label}</div>
              {row.cells.map((cell, ci) => (
                <div className="cmp-cell" key={cell.columnId}>
                  {cell.private ? (
                    <div
                      className="cmp-val"
                      title={
                        row.key === "storyResponse"
                          ? "Story Response Rate is a Graph API insight only available for Nivin's own account — never for another user's page."
                          : "Reel view counts require Apify's paid detailed-data tier, which this integration doesn't request — not evaluated rather than estimated."
                      }
                    >
                      —
                    </div>
                  ) : (
                    <>
                      <div className={`cmp-val${cell.isWin ? " win" : ""}`}>
                        {cell.display}
                        {cell.isEstimate ? (
                          <span
                            style={{ fontSize: 9, color: "var(--muted)", fontWeight: 500, marginLeft: 3 }}
                            title="Estimated from public likes + comments over followers — true reach and saves aren't available for accounts other than your own."
                          >
                            est.
                          </span>
                        ) : null}
                      </div>
                      <div className="cmp-bar-wrap">
                        <div
                          style={{
                            width: `${cell.pct}%`,
                            height: "100%",
                            background: cell.isEstimate ? "var(--muted)" : ci === 0 ? "var(--accent)" : "var(--blue)",
                            opacity: cell.isEstimate ? 0.6 : 1,
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      {row.key === "followers" ? (
                        <FollowerTrendMini trend={columns[ci].followerTrend} deltaPct={columns[ci].followerTrendDeltaPct} />
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

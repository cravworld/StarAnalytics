import Link from "next/link";
import { getScoutBatchCompareData } from "@/lib/data/scout";
import { Card } from "@/components/ui/Card";

export default async function ScoutComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  const batchIds = (ids ?? "").split(",").filter(Boolean);

  if (batchIds.length < 2) {
    return (
      <Card title="Compare Batches">
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
          Select 2 or more batches on the <Link href="/scout">Scoutline</Link> page to compare them.
        </div>
      </Card>
    );
  }

  const comparisons = await getScoutBatchCompareData(batchIds);

  return (
    <Card title="Compare Batches">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${comparisons.length}, 1fr)`, gap: 16, overflowX: "auto" }}>
        {comparisons.map((c) => (
          <div key={c.batch.id} style={{ border: "1px solid var(--rule)", borderRadius: "var(--radius)", padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              <Link href={`/scout/${c.batch.id}`}>{c.batch.fileName}</Link>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
              {new Date(c.batch.createdAt).toLocaleDateString()}
            </div>

            <div className="kpi-grid kpi-grid-3" style={{ marginBottom: 12 }}>
              <div className="kpi">
                <div className="kpi-label">Accounts</div>
                <div className="kpi-val">{c.batch.parsedCount}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Scored</div>
                <div className="kpi-val">{c.batch.scoredCount}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Avg Buzz</div>
                <div className="kpi-val">
                  {c.avgBuzzFactor ?? (
                    <span className="na" title="No accounts in this batch have been scored yet, so there is no average to show.">—</span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Top accounts</div>
            {c.topAccounts.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>No scored accounts yet.</div>
            ) : (
              c.topAccounts.map((a) => (
                <div key={a.handle} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
                  <span>@{a.handle}</span>
                  <strong>{a.buzzFactor}</strong>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

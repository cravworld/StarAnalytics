import { notFound } from "next/navigation";
import { getScoutBatch, getScoutLeaderboard, getScoutRawRows } from "@/lib/data/scout";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { ScoutAutoRefresh } from "@/components/scout/ScoutAutoRefresh";
import { ScoutRetryButton } from "@/components/scout/ScoutRetryButton";
import { ScoutViewToggle } from "@/components/scout/ScoutViewToggle";
import { ScoutDataTable } from "@/components/scout/ScoutDataTable";
import { CsvExportRegistrar } from "@/components/shell/CsvExportRegistrar";

const rankClass = (i: number) => (i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "");
const scoreColor = (s: number) => (s >= 70 ? "#1a7a4a" : s >= 40 ? "#b45309" : "#b71c1c");

export default async function ScoutBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const [batch, rows, rawRows] = await Promise.all([
    getScoutBatch(batchId),
    getScoutLeaderboard(batchId),
    getScoutRawRows(batchId),
  ]);
  if (!batch) notFound();

  const scanning = batch.runsTotal > 0 && batch.runsDone + batch.runsErrored < batch.runsTotal;
  const missingCount = !scanning ? batch.parsedCount - batch.scoredCount : 0;

  return (
    <>
      <ScoutAutoRefresh active={scanning} />
      <div className="kpi-grid kpi-grid-4">
        <div className="kpi">
          <div className="kpi-label">Accounts</div>
          <div className="kpi-val">{batch.parsedCount}</div>
          {batch.expectedCount !== batch.parsedCount ? (
            <div className="kpi-delta">{batch.expectedCount - batch.parsedCount} rows didn&apos;t parse — see below</div>
          ) : null}
        </div>
        <div className="kpi">
          <div className="kpi-label">Scored</div>
          <div className="kpi-val">{batch.scoredCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Status</div>
          <div className="kpi-val" style={{ fontSize: 16 }}>
            <Pill kind={scanning ? "warn" : batch.runsErrored > 0 ? "bad" : "good"}>
              {scanning ? "Scanning…" : batch.runsErrored > 0 ? `Done (${batch.runsErrored} run errors)` : "Done"}
            </Pill>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Source</div>
          <div className="kpi-val" style={{ fontSize: 16 }}>{batch.fileName}</div>
        </div>
      </div>

      {missingCount > 0 ? (
        <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {missingCount} account{missingCount === 1 ? "" : "s"} didn&apos;t get scored — most often an Apify run timing out on a slow chunk, not a bad account.
          </div>
          <ScoutRetryButton batchId={batch.id} missingCount={missingCount} />
        </div>
      ) : null}

      <CsvExportRegistrar
        filename={`scoutline-${batch.fileName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`}
        headers={[
          "Handle", "Name", "Deliverable", "Buzz", "Followers", "Engagement %", "Comment rate %",
          "Consistency", "Posts/week", "Clips %", "Carousel %", "Image %", "Posts analyzed", "Note",
        ]}
        rows={rawRows.map((r) => [
          r.handle, r.suppliedName ?? "", r.deliverable ?? "", r.buzzFactor ?? "", r.followers ?? "",
          r.engagementRatePct ?? "", r.commentRatePct ?? "", r.consistencyScore ?? "",
          r.postingFrequencyPerWeek ?? "", r.contentMixClipsPct ?? "", r.contentMixCarouselPct ?? "",
          r.contentMixImagePct ?? "", r.postsAnalyzed ?? "", r.note ?? "",
        ])}
      />

      <ScoutViewToggle
        leaderboard={
          <Card title="Buzz Factor Leaderboard">
            {rows.length === 0 ? (
              <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>No accounts in this batch.</div>
            ) : (
              rows.map((r, i) => (
                <div className="lb-row" key={r.candidateId}>
                  <div className={`lb-rank ${rankClass(i)}`}>{r.buzzFactor !== null ? i + 1 : "–"}</div>
                  <div className="lb-body">
                    <div className="lb-name">
                      <a href={`https://www.instagram.com/${r.handle}/`} target="_blank" rel="noreferrer">
                        @{r.handle}
                      </a>
                      {r.suppliedName ? <span style={{ color: "var(--muted)", fontWeight: 400 }}>{r.suppliedName}</span> : null}
                      {r.deliverable ? <Pill kind="default">{r.deliverable}</Pill> : null}
                    </div>
                    {r.buzzFactor !== null ? (
                      <>
                        <div className="lb-bar-track">
                          <div className="lb-bar-fill" style={{ width: `${r.buzzFactor}%`, background: scoreColor(r.buzzFactor) }} />
                        </div>
                        <div className="lb-meta">
                          {r.followers !== null ? <span>Followers <strong>{r.followers.toLocaleString()}</strong></span> : null}
                          {r.engagementRatePct !== null ? (
                            <span>Engagement <strong>{r.engagementRatePct.toFixed(1)}%</strong></span>
                          ) : null}
                          {r.components ? (
                            <span>
                              Reach {r.components.reach ?? "–"} · Consistency {r.components.consistency ?? "–"} · Content mix {r.components.contentMix ?? "–"}
                            </span>
                          ) : null}
                          {r.note ? <span style={{ color: "var(--amber)" }}>{r.note}</span> : null}
                        </div>
                      </>
                    ) : (
                      <div className="lb-meta">Scan in progress…</div>
                    )}
                  </div>
                  {r.buzzFactor !== null ? (
                    <div className="lb-score" style={{ color: scoreColor(r.buzzFactor) }}>{r.buzzFactor}</div>
                  ) : null}
                </div>
              ))
            )}
          </Card>
        }
        table={<ScoutDataTable rows={rawRows} />}
      />
    </>
  );
}

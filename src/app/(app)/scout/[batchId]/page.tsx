import { notFound } from "next/navigation";
import { getScoutBatch, getScoutLeaderboard, getScoutRawRows } from "@/lib/data/scout";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { ScoutAutoRefresh } from "@/components/scout/ScoutAutoRefresh";
import { ScoutRetryButton } from "@/components/scout/ScoutRetryButton";
import { ScoutRescoreButton } from "@/components/scout/ScoutRescoreButton";
import { ScoutLeaderboardFilterable } from "@/components/scout/ScoutLeaderboardFilterable";
import { CsvExportRegistrar } from "@/components/shell/CsvExportRegistrar";

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

      {!scanning ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 16 }}>
          <a className="btn" href={`/api/scout/${batch.id}/export`}>
            Export to Excel
          </a>
          <ScoutRescoreButton batchId={batch.id} />
        </div>
      ) : null}

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

      <ScoutLeaderboardFilterable rows={rows} rawRows={rawRows} />
    </>
  );
}

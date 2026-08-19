"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  getCampaignCompareOptions,
  getCampaignCompareData,
  getCampaignCompareDataAtDay,
} from "@/lib/data/campaigns";
import { useTopbarExport } from "@/components/shell/TopbarExportContext";
import { toCsv } from "@/lib/csv";

type Options = Awaited<ReturnType<typeof getCampaignCompareOptions>>;
type CompareResult = Awaited<ReturnType<typeof getCampaignCompareData>>;
type CompareAtDayResult = Awaited<ReturnType<typeof getCampaignCompareDataAtDay>>;

const DEFAULT_DAY_N = 7;

// Two modes, one component: normal (current totals) and "day-N cohort" (see
// getCampaignCompareDataAtDay's own comment for the honest caveat on what that second mode
// actually compares). dayNResult present is the discriminant — page.tsx passes exactly one
// of {columns,rows} or {dayNResult}, never both, driven by the ?dayN= URL param.
export function CampaignCompareClient({
  options,
  selectedIds,
  columns,
  rows,
  dayNResult,
}: {
  options: Options;
  selectedIds: string[];
  columns?: CompareResult["columns"];
  rows?: CompareResult["rows"];
  dayNResult?: CompareAtDayResult;
}) {
  const router = useRouter();
  const [dayNInput, setDayNInput] = useState(String(dayNResult?.dayN ?? DEFAULT_DAY_N));

  function buildUrl(ids: string[], dayN: number | null) {
    const params = new URLSearchParams();
    if (ids.length > 0) params.set("ids", ids.join(","));
    if (dayN !== null) params.set("dayN", String(dayN));
    return `/campaigns/compare-own?${params.toString()}`;
  }

  function toggle(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    router.push(buildUrl(next, dayNResult?.dayN ?? null));
  }

  function applyDayN() {
    const n = Number(dayNInput);
    if (Number.isInteger(n) && n > 0) router.push(buildUrl(selectedIds, n));
  }

  function backToCurrentTotals() {
    router.push(buildUrl(selectedIds, null));
  }

  const effectiveColumns = dayNResult ? dayNResult.columns : (columns ?? []);
  const effectiveRows = dayNResult ? dayNResult.rows : (rows ?? []);
  const gridCols = `160px repeat(${Math.max(effectiveColumns.length, 1)}, 1fr)`;

  const exportConfig = useMemo(
    () =>
      effectiveColumns.length > 0
        ? {
            filename: dayNResult ? `campaign-compare-day${dayNResult.dayN}.csv` : "campaign-compare.csv",
            csv: () =>
              toCsv(
                ["Metric", ...effectiveColumns.map((c) => c.name)],
                effectiveRows.map((row) => [row.label, ...row.cells.map((c) => c.display)]),
              ),
          }
        : null,
    [effectiveColumns, effectiveRows, dayNResult],
  );
  useTopbarExport(exportConfig);

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {options.map((o) => (
          <label
            key={o.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              background: selectedIds.includes(o.id) ? "var(--accent-tint)" : "transparent",
            }}
          >
            <input type="checkbox" checked={selectedIds.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.name}
            <span style={{ color: "var(--muted)" }}>({o.status})</span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {dayNResult ? (
          <>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Comparing each campaign's first{" "}
              <strong>
                {dayNResult.dayN} day{dayNResult.dayN === 1 ? "" : "s"}
              </strong>{" "}
              since launch — current engagement of that cohort, not a historical replay.
            </span>
            <button className="tb-btn" onClick={backToCurrentTotals}>
              ← Back to current totals
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Compare at day</span>
            <input
              type="number"
              min={1}
              value={dayNInput}
              onChange={(e) => setDayNInput(e.target.value)}
              style={{ width: 64 }}
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>since each campaign's launch</span>
            <button className="tb-btn" onClick={applyDayN}>
              Apply
            </button>
          </>
        )}
      </div>

      {effectiveColumns.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          Select at least one campaign to compare.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className="cmp-grid" style={{ gridTemplateColumns: gridCols, minWidth: 160 + effectiveColumns.length * 140 }}>
            <div />
            {effectiveColumns.map((col) => (
              <div key={col.id} className="cmp-header">
                <div style={{ fontSize: 13, fontWeight: 700 }}>{col.name}</div>
                {dayNResult ? (
                  "hasStartDate" in col && !col.hasStartDate ? (
                    <div style={{ fontSize: 10, color: "var(--red)", marginTop: 4 }}>No start date set</div>
                  ) : null
                ) : "tag" in col ? (
                  <>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{col.tag || "(no hashtags set)"}</div>
                    {col.topHashtag ? (
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Top tag: #{col.topHashtag}</div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 0, minWidth: 160 + effectiveColumns.length * 140 }}>
            {effectiveRows.map((row, i) => (
              <div
                className="cmp-row"
                style={{ gridTemplateColumns: gridCols, padding: "9px 14px", borderBottom: i === effectiveRows.length - 1 ? "none" : undefined }}
                key={row.key}
              >
                <div className="cmp-label">{row.label}</div>
                {row.cells.map((cell) => (
                  <div className="cmp-cell" key={cell.columnId}>
                    <div className={`cmp-val${cell.isWin ? " win" : ""}`}>{cell.display}</div>
                    <div className="cmp-bar-wrap">
                      <div style={{ width: `${cell.pct}%`, height: "100%", background: "var(--accent)", borderRadius: "var(--radius-xs)" }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

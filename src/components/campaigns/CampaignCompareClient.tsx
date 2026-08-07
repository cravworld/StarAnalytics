"use client";

import { useRouter } from "next/navigation";
import type { getCampaignCompareOptions, getCampaignCompareData } from "@/lib/data/campaigns";

type Options = Awaited<ReturnType<typeof getCampaignCompareOptions>>;
type CompareResult = Awaited<ReturnType<typeof getCampaignCompareData>>;

export function CampaignCompareClient({
  options,
  selectedIds,
  columns,
  rows,
}: {
  options: Options;
  selectedIds: string[];
  columns: CompareResult["columns"];
  rows: CompareResult["rows"];
}) {
  const router = useRouter();

  function toggle(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    router.push(next.length > 0 ? `/campaigns/compare-own?ids=${next.join(",")}` : "/campaigns/compare-own?ids=");
  }

  const gridCols = `160px repeat(${Math.max(columns.length, 1)}, 1fr)`;

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
              borderRadius: 6,
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

      {columns.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          Select at least one campaign to compare.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className="cmp-grid" style={{ gridTemplateColumns: gridCols, minWidth: 160 + columns.length * 140 }}>
            <div />
            {columns.map((col) => (
              <div key={col.id} className="cmp-header">
                <div style={{ fontSize: 13, fontWeight: 700 }}>{col.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{col.tag || "(no hashtags set)"}</div>
                {col.topHashtag ? (
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Top tag: #{col.topHashtag}</div>
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
                {row.cells.map((cell) => (
                  <div className="cmp-cell" key={cell.columnId}>
                    <div className={`cmp-val${cell.isWin ? " win" : ""}`}>{cell.display}</div>
                    <div className="cmp-bar-wrap">
                      <div style={{ width: `${cell.pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Pill } from "@/components/ui/Pill";
import type { ScoutBatchSummary } from "@/lib/data/scout";

export function ScoutBatchList({ batches }: { batches: ScoutBatchSummary[] }) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const visible = useMemo(
    () => batches.filter((b) => (showArchived ? true : !b.archivedAt)),
    [batches, showArchived],
  );
  const archivedCount = batches.filter((b) => b.archivedAt).length;

  async function toggleArchive(e: React.MouseEvent, batchId: string, archived: boolean) {
    e.preventDefault();
    e.stopPropagation();
    setPendingId(batchId);
    try {
      await fetch(`/api/scout/${batchId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  function toggleSelected(batchId: string) {
    setSelected((s) => (s.includes(batchId) ? s.filter((id) => id !== batchId) : s.length < 4 ? [...s, batchId] : s));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived ({archivedCount})
        </label>
        {selected.length >= 2 ? (
          <Link className="btn btn-primary" href={`/scout/compare?ids=${selected.join(",")}`}>
            Compare {selected.length} batches
          </Link>
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Select 2-4 batches to compare</span>
        )}
      </div>

      {visible.length === 0 ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
          {showArchived ? "No batches." : "No batches yet — upload a list above to run the first scan."}
        </div>
      ) : (
        visible.map((b) => {
          const done = b.runsTotal > 0 && b.runsDone + b.runsErrored === b.runsTotal;
          return (
            <Link
              key={b.id}
              href={`/scout/${b.id}`}
              className="htag-row"
              style={{ textDecoration: "none", color: "inherit", opacity: b.archivedAt ? 0.55 : 1 }}
            >
              <input
                type="checkbox"
                checked={selected.includes(b.id)}
                onChange={() => toggleSelected(b.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ marginRight: 4 }}
              />
              <div className="htag-name scout-batch-name" title={b.fileName}>{b.fileName}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {b.parsedCount} accounts · {new Date(b.createdAt).toLocaleDateString()}
              </div>
              <div className="htag-eng">{b.scoredCount}/{b.parsedCount} scored</div>
              <Pill kind={done ? "good" : "warn"}>{done ? "Done" : "Scanning…"}</Pill>
              <button
                className="btn"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={pendingId === b.id}
                onClick={(e) => toggleArchive(e, b.id, !b.archivedAt)}
              >
                {pendingId === b.id ? "…" : b.archivedAt ? "Unarchive" : "Archive"}
              </button>
            </Link>
          );
        })
      )}
    </div>
  );
}

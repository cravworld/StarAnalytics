"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface UploadResult {
  batchId: string;
  expectedCount: number;
  parsedCount: number;
  freshCount: number;
  needsScanCount: number;
  staleDays: number;
}

export function ScoutUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only when the upload came back with accounts that were already scanned recently —
  // the confirmation step (2026-08-18) that stops a re-uploaded/overlapping list from
  // silently burning fresh Apify credits on accounts already scanned this week.
  const [pendingConfirm, setPendingConfirm] = useState<UploadResult | null>(null);

  async function startRuns(batchId: string, mode: "all" | "new-only") {
    await fetch(`/api/scout/${batchId}/start-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    router.push(`/scout/${batchId}`);
  }

  async function onUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    setPendingConfirm(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // Upload only parses + persists the batch now — it no longer starts any Apify run
      // itself, so we can check freshness first and ask before spending credits.
      const res = await fetch("/api/scout/upload", { method: "POST", body: form });
      const data: UploadResult & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);

      if (data.freshCount > 0) {
        // Some accounts were scanned recently — let the user decide before any credit gets
        // spent, instead of always re-scanning everyone unconditionally.
        setPendingConfirm(data);
      } else {
        await startRuns(data.batchId, "all");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (pendingConfirm) {
    const { batchId, parsedCount, freshCount, needsScanCount, staleDays } = pendingConfirm;
    return (
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {freshCount} of {parsedCount} account{parsedCount === 1 ? "" : "s"} {freshCount === 1 ? "was" : "were"} already scanned in
          the last {staleDays} day{staleDays === 1 ? "" : "s"}.
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
          Skip them to reuse the existing data and only spend Apify credits on the {needsScanCount} new/stale account
          {needsScanCount === 1 ? "" : "s"} — or rescan everyone if you want fresh numbers across the board.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => startRuns(batchId, "new-only")}>
            Skip Already-Scanned ({needsScanCount} to scan)
          </button>
          <button className="btn" onClick={() => startRuns(batchId, "all")}>
            Rescan All ({parsedCount})
          </button>
          <button className="btn" onClick={() => setPendingConfirm(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input ref={inputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" disabled={pending} />
        <button className="btn btn-primary" onClick={onUpload} disabled={pending}>
          {pending ? "Checking accounts…" : "Scan Accounts"}
        </button>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
        PDF or Excel/CSV — one Instagram link per account, up to a few hundred at a time.
      </div>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

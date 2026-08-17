"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function ScoutUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // Upload starts the Apify run(s) and returns immediately — ingestion happens on a
      // cron, not this request (see scout.ts's module doc for why it has to work this way).
      const res = await fetch("/api/scout/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      router.push(`/scout/${data.batchId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input ref={inputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" disabled={pending} />
        <button className="btn btn-primary" onClick={onUpload} disabled={pending}>
          {pending ? "Starting scan…" : "Scan Accounts"}
        </button>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
        PDF or Excel/CSV — one Instagram link per account, up to a few hundred at a time.
      </div>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

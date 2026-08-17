"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// For "just check this one account real quick" — no file needed. One link/handle per line
// (commas also work), same pipeline as a file upload from here on.
export function ScoutQuickAddForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onScan() {
    if (!text.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/scout/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Scan failed (${res.status})`);
      router.push(`/scout/${data.batchId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">Quick Scan</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
        Paste one or a few Instagram links or @handles, one per line.
      </div>
      <textarea
        rows={3}
        placeholder={"@some.account\nhttps://www.instagram.com/another_account/"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        style={{ width: "100%", resize: "vertical", marginBottom: 8 }}
      />
      <button className="btn btn-primary" onClick={onScan} disabled={pending || !text.trim()}>
        {pending ? "Starting scan…" : "Scan"}
      </button>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

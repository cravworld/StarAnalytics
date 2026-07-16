"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addCompetitorAction, removeCompetitorAction } from "@/lib/actions/compare";

export function AddCompetitorForm() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    if (!handle.trim()) return;
    setPending(true);
    setError(null);
    try {
      // A real Apify profile+post scrape runs synchronously here — the one place this
      // handle's first scrape happens, since a brand-new row has no lastScrapedAt yet.
      await addCompetitorAction(handle);
      setHandle("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <input
          placeholder="Instagram handle (e.g. @competitor_handle)…"
          style={{ flex: 1 }}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          disabled={pending}
        />
        <button className="btn btn-primary" onClick={onAdd} disabled={pending || !handle.trim()}>
          {pending ? "Adding…" : "＋ Add account to compare"}
        </button>
      </div>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

export function RemoveCompetitorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onRemove() {
    setPending(true);
    try {
      await removeCompetitorAction(id);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={onRemove}
      disabled={pending}
      title="Remove from comparison"
      style={{ position: "absolute", top: 6, right: 6, border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
    >
      {pending ? "…" : "✕"}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addCompetitorAction, removeCompetitorAction } from "@/lib/actions/compare";
import type { PlatformId } from "@/lib/providers/types";

const PLACEHOLDERS: Record<PlatformId, string> = {
  instagram: "Instagram handle (e.g. @competitor_handle)…",
  youtube: "YouTube handle (e.g. @channelname)…",
};

export function AddCompetitorForm() {
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformId>("instagram");
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    if (!handle.trim()) return;
    setPending(true);
    setError(null);
    try {
      // A real profile+post scrape (Apify for Instagram, YouTube Data API v3 for YouTube)
      // runs synchronously here — the one place this handle's first scrape happens, since
      // a brand-new row has no lastScrapedAt yet.
      await addCompetitorAction(handle, platform);
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
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PlatformId)}
          disabled={pending}
          style={{ width: 110 }}
        >
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
        <input
          placeholder={PLACEHOLDERS[platform]}
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

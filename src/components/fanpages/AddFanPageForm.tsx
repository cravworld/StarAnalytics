"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addFanPageAction } from "@/lib/actions/fanpages";
import type { PlatformId } from "@/lib/providers/types";

const PLACEHOLDERS: Record<PlatformId, string> = {
  instagram: "Instagram handle (e.g. @fanpage_handle)…",
  youtube: "YouTube handle (e.g. @channelname)…",
};

export function AddFanPageForm() {
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
      // Instagram: a real Apify profile-only scrape runs synchronously here, same pattern
      // as TrackHashtagForm's hashtag scrape. YouTube: pulls the channel's own uploads
      // directly (no hashtag pipeline to lean on) — see fanpages.ts.
      await addFanPageAction(handle, platform);
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
          {pending ? "Adding…" : "＋ Add fan page to track"}
        </button>
      </div>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

// Inline promote button for a suggested handle — same action, fixed argument, no
// free-text input. This is the only place the suggested handle's Apify profile
// scrape cost actually gets spent (see AGENTS.md/plan "suggest, don't auto-add").
export function PromoteSuggestionButton({ handle }: { handle: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    setPending(true);
    setError(null);
    try {
      await addFanPageAction(handle);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={onAdd} disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </button>
      {error ? <div style={{ color: "var(--red)", fontSize: 10, marginTop: 4 }}>{error}</div> : null}
    </div>
  );
}

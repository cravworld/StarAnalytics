"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackHashtagAction } from "@/lib/actions/campaigns";

export function TrackHashtagForm() {
  const router = useRouter();
  const [tag, setTag] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onTrack() {
    if (!tag.trim()) return;
    setPending(true);
    setError(null);
    try {
      // A real Apify hashtag scrape (10-20s) runs synchronously here so the table
      // below reflects real data the moment tracking succeeds — see scrapeByHashtag.
      await trackHashtagAction(tag);
      setTag("");
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
          placeholder="Search any hashtag or keyword…"
          style={{ flex: 1 }}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          disabled={pending}
        />
        <button className="btn btn-primary" onClick={onTrack} disabled={pending || !tag.trim()}>
          {pending ? "Scraping…" : "Track Hashtag"}
        </button>
      </div>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

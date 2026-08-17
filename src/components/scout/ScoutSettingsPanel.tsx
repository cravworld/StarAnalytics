"use client";

import { useState } from "react";
import type { ScoutSettingsValue } from "@/lib/data/scoutSettings";

// Editable actor factors + Buzz Factor weights, shown collapsed by default — this is a
// "before you start a scrape" tuning panel, not something most visits need open. Saved
// settings only affect batches started *after* saving (see ScoutBatch's own snapshot
// comment) — a batch already scanning is never retroactively changed.
export function ScoutSettingsPanel({ initial }: { initial: ScoutSettingsValue }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ScoutSettingsValue>(key: K, value: ScoutSettingsValue[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function onSave() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/scout/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
      setSettings(data);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const weightSum =
    settings.weightEngagement + settings.weightReach + settings.weightConsistency + settings.weightContentMix;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
        }}
      >
        <div className="card-title" style={{ margin: 0 }}>
          Scan Settings
        </div>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{open ? "Hide" : "Edit before scanning"}</span>
      </button>

      {open ? (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
              Apify actor factors
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <label style={{ fontSize: 12 }}>
                Posts per account
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.postsToAnalyze}
                  onChange={(e) => set("postsToAnalyze", Number(e.target.value))}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Post type filter
                <select
                  value={settings.postTypeFilter}
                  onChange={(e) => set("postTypeFilter", e.target.value)}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="all">All</option>
                  <option value="feed">Feed only</option>
                  <option value="clips">Reels/clips only</option>
                  <option value="carousel_container">Carousels only</option>
                </select>
              </label>
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
                <input
                  type="checkbox"
                  checked={settings.skipPinnedPosts}
                  onChange={(e) => set("skipPinnedPosts", e.target.checked)}
                />
                Skip pinned posts
              </label>
              <label style={{ fontSize: 12 }}>
                Only posts newer than (optional)
                <input
                  type="text"
                  placeholder="e.g. 90 days or 2026-01-01"
                  value={settings.dateFilter ?? ""}
                  onChange={(e) => set("dateFilter", e.target.value || null)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
              Buzz Factor weights {weightSum.toFixed(2) !== "1.00" ? `(relative — sum ${weightSum.toFixed(2)}, auto-normalized)` : ""}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {(
                [
                  ["weightEngagement", "Engagement rate"],
                  ["weightReach", "Reach (followers)"],
                  ["weightConsistency", "Consistency"],
                  ["weightContentMix", "Content mix (reels %)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} style={{ fontSize: 12 }}>
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings[key]}
                    onChange={(e) => set(key, Number(e.target.value))}
                    style={{ width: "100%", marginTop: 4 }}
                  />
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn btn-primary" onClick={onSave} disabled={pending}>
              {pending ? "Saving…" : "Save Settings"}
            </button>
            {saved ? <span style={{ color: "var(--green)", fontSize: 12 }}>Saved — used by the next scan.</span> : null}
            {error ? <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

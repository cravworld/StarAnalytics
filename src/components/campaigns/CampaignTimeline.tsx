"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCampaignEventAction, deleteCampaignEventAction } from "@/lib/actions/campaigns";
import type { CampaignEventRow } from "@/lib/data/campaignEvents";

// Hand-logged milestones (trailer drop, premiere, ...) shown chronologically next to the
// Sentiment Over Time chart — cross-referencing dates by eye ("did the trailer move it")
// is the whole point, see feature pitch. Same pending/error/router.refresh() pattern as
// TrackHashtagForm.tsx.
export function CampaignTimeline({ campaignId, events }: { campaignId: string; events: CampaignEventRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    if (!label.trim() || !date) return;
    setPending(true);
    setError(null);
    try {
      await addCampaignEventAction(campaignId, label, date);
      setLabel("");
      setDate("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function onDelete(eventId: string) {
    setPending(true);
    setError(null);
    try {
      await deleteCampaignEventAction(campaignId, eventId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="e.g. Trailer Drop"
          style={{ flex: 1 }}
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
          disabled={pending}
        />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={pending} />
        <button className="btn btn-primary" onClick={onAdd} disabled={pending || !label.trim() || !date}>
          Add
        </button>
      </div>
      {error ? <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 8 }}>{error}</div> : null}

      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
          No milestones logged yet — add a trailer drop, premiere, or release date to see it against sentiment
          below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {events.map((e) => (
            <div
              key={e.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0" }}
            >
              <span>
                <strong>{e.eventDateLabel}</strong> — {e.label}
              </span>
              <button
                onClick={() => onDelete(e.id)}
                disabled={pending}
                aria-label={`Remove ${e.label}`}
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

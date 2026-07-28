"use client";

import { useEffect, useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { getCampaignStreamAction } from "@/lib/actions/campaigns";
import type { StreamItem } from "@/lib/data/campaigns";

// The prototype wraps hashtags in <em> so `.stream-text em` renders them in accent
// pink. Split at render time rather than storing markup in the data.
function StreamText({ text }: { text: string }) {
  return (
    <div className="stream-text">
      {text.split(/(#\w+)/g).map((part, i) => (part.startsWith("#") ? <em key={i}>{part}</em> : part))}
    </div>
  );
}

// Polls the same requireSession()-gated data layer every other screen already uses, rather
// than a Supabase Realtime subscription keyed off the public anon key — see
// getCampaignStreamAction for why (RLS is enabled with zero policies on `posts`, so that key
// can't read anything and the old subscription silently never fired). A few seconds of
// staleness is an acceptable trade for not standing up a second, separately-secured
// credential just for this one feature.
const POLL_INTERVAL_MS = 8000;

export function LiveStream({ campaignId, initial }: { campaignId: string; initial: StreamItem[] }) {
  const [items, setItems] = useState(initial);
  const [live, setLive] = useState(true);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const fresh = await getCampaignStreamAction(campaignId);
        if (cancelled) return;
        setItems(fresh);
        setLive(true);
      } catch (err) {
        if (cancelled) return;
        console.error("[LiveStream] poll failed:", err);
        setLive(false);
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [campaignId]);

  return (
    <>
      <div style={{ fontSize: 11, color: live ? "var(--green)" : "var(--faint)", marginBottom: 8 }}>
        {live ? "● Live — updates automatically" : "○ Live updates paused — refresh to retry"}
      </div>
      {items.length === 0 ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>
          No posts scraped for this campaign yet.
        </div>
      ) : (
        items.map((s) => (
          <div className="stream-item" key={s.id}>
            <div className="stream-av" style={{ background: s.bg, color: s.c }}>
              {s.av}
            </div>
            <div className="stream-body">
              <a
                className="stream-handle"
                href={`https://instagram.com/${s.handle.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.handle}
              </a>
              <span className="stream-time">{s.time}</span>
              {s.externalUrl ? (
                <a href={s.externalUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                  <StreamText text={s.text} />
                </a>
              ) : (
                <StreamText text={s.text} />
              )}
              <div className="stream-stats">
                <span className="sst">♥ {s.likes}</span>
                <span className="sst">💬 {s.comments}</span>
                <Pill kind={s.tag === "Fan page" ? "fan" : "default"}>{s.tag}</Pill>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}

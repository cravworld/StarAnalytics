"use client";

import { useEffect, useState } from "react";
import { createClient, type RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { Pill } from "@/components/ui/Pill";
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

const STREAM_PALETTE = [
  { bg: "#fde8ef", c: "#E1306C" },
  { bg: "#e8f5e9", c: "#1a7a4a" },
  { bg: "#e3f2fd", c: "#1565c0" },
  { bg: "#f3e5f5", c: "#6a1b9a" },
];

interface PostRow {
  id: string;
  campaign_id: string | null;
  author_handle: string | null;
  posted_at: string | null;
  scraped_at: string;
  caption: string | null;
  likes: number | null;
  comments: number | null;
}

function rowToStreamItem(row: PostRow, i: number): StreamItem {
  const handle = (row.author_handle ?? "").replace(/^@/, "");
  const palette = STREAM_PALETTE[i % STREAM_PALETTE.length];
  return {
    id: row.id,
    av: handle.slice(0, 2).toUpperCase() || "??",
    bg: palette.bg,
    c: palette.c,
    handle: handle ? `@${handle}` : "@unknown",
    time: new Date(row.posted_at ?? row.scraped_at).toLocaleString(),
    text: row.caption ?? "",
    likes: String(row.likes ?? 0),
    comments: String(row.comments ?? 0),
    // Realtime inserts don't re-run the fan-page lookup that the initial server
    // render does — new items show as "Public" until the next full page load.
    tag: "Public",
  };
}

export function LiveStream({ campaignId, initial }: { campaignId: string; initial: StreamItem[] }) {
  const [items, setItems] = useState(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return; // Realtime not configured — falls back to a static list.

    const supabase = createClient(url, key);
    const channel = supabase
      .channel(`posts-campaign-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts", filter: `campaign_id=eq.${campaignId}` },
        (payload: RealtimePostgresInsertPayload<PostRow>) => {
          setItems((prev) => [rowToStreamItem(payload.new, 0), ...prev].slice(0, 30));
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const realtimeConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <>
      {realtimeConfigured ? (
        <div style={{ fontSize: 11, color: connected ? "var(--green)" : "var(--faint)", marginBottom: 8 }}>
          {connected ? "● Live — updates automatically" : "○ Connecting…"}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 8 }}>
          Realtime not configured (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY) — refresh to see new posts.
        </div>
      )}
      {items.length === 0 ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>
          No posts scraped for this campaign yet.
        </div>
      ) : (
        items.map((s, i) => (
          <div className="stream-item" key={s.id}>
            <div className="stream-av" style={{ background: s.bg, color: s.c }}>
              {s.av}
            </div>
            <div className="stream-body">
              <span className="stream-handle">{s.handle}</span>
              <span className="stream-time">{s.time}</span>
              <StreamText text={s.text} />
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

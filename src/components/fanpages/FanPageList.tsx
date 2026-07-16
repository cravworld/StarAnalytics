"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/Pill";

export interface FanPageRow {
  name: string;
  handle: string;
  bg: string;
  c: string;
  init: string;
  followers: string;
  followersRaw: number;
  eng: string;
  engRaw: number;
  posts: string;
  postsTodayRaw: number;
  status: boolean;
  spark: number[];
  vijayam: boolean;
  isVerifiedFan: boolean;
}

type Tab = "all" | "active" | "tagged" | "reach";

// Fetched once server-side; tabs just re-sort/filter the same array client-side —
// no extra round trips per tab click.
export function FanPageList({ fanPages }: { fanPages: FanPageRow[] }) {
  const [tab, setTab] = useState<Tab>("all");

  let rows = fanPages;
  if (tab === "active") {
    rows = fanPages.filter((f) => f.status).sort((a, b) => b.postsTodayRaw - a.postsTodayRaw);
  } else if (tab === "tagged") {
    rows = fanPages.filter((f) => f.vijayam);
  } else if (tab === "reach") {
    rows = [...fanPages].sort((a, b) => b.followersRaw - a.followersRaw);
  }

  return (
    <>
      <div className="inner-tabs">
        <button className={`itab${tab === "all" ? " active" : ""}`} onClick={() => setTab("all")}>
          All ({fanPages.length})
        </button>
        <button className={`itab${tab === "active" ? " active" : ""}`} onClick={() => setTab("active")}>
          Most Active
        </button>
        <button className={`itab${tab === "tagged" ? " active" : ""}`} onClick={() => setTab("tagged")}>
          Posting Campaign Tags
        </button>
        <button className={`itab${tab === "reach" ? " active" : ""}`} onClick={() => setTab("reach")}>
          Largest Reach
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>No fan pages match this view.</div>
        ) : (
          rows.map((f) => {
            const maxSpark = Math.max(1, ...f.spark);
            return (
              <div className="fan-row" key={f.handle}>
                <div className="fan-av" style={{ background: f.bg, color: f.c }}>
                  {f.init}
                </div>
                <div className="fan-info">
                  <div className="fan-name">
                    {f.name} {f.isVerifiedFan ? <Pill kind="fan">Verified fan</Pill> : null}
                  </div>
                  <div className="fan-handle">{f.handle}</div>
                  <div className="fan-stats">
                    <span className="fan-stat">
                      <strong>{f.followers}</strong> followers
                    </span>
                    <span className="fan-stat">
                      <strong>{f.eng}</strong> eng
                    </span>
                    <span className="fan-stat">
                      <strong>{f.posts}</strong> today
                    </span>
                  </div>
                </div>
                <div className="fan-right">
                  <div className="mini-spark">
                    {f.spark.map((v, i) => (
                      <div className={`ms-bar${v >= maxSpark ? " mhi" : ""}`} style={{ height: `${v}%` }} key={i} />
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div className={`sdot ${f.status ? "sdot-on" : "sdot-off"}`} />
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{f.status ? "Active now" : "Idle"}</span>
                  </div>
                  {f.vijayam ? (
                    <span className="pill pill-hot" style={{ fontSize: 10 }}>
                      Tracked tag
                    </span>
                  ) : (
                    <span className="pill" style={{ fontSize: 10 }}>
                      Not yet
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

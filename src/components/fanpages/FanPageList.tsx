"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pill } from "@/components/ui/Pill";
import type { FanPageListRow } from "@/lib/data/fanpages";
import { useTopbarExport } from "@/components/shell/TopbarExportContext";
import { toCsv } from "@/lib/csv";
import { platformInk } from "@/lib/palette";

// The row shape is owned by the query that produces it (lib/data/fanpages.ts) rather than
// re-declared here, so adding a field to one can't silently leave the other behind. Type-only
// import: erased at build time, so this client component pulls in no server code.
export type { FanPageListRow as FanPageRow };

type Tab = "all" | "active" | "tagged" | "reach";

// Fetched once server-side; tabs just re-sort/filter the same array client-side —
// no extra round trips per tab click.
export function FanPageList({ fanPages }: { fanPages: FanPageListRow[] }) {
  const [tab, setTab] = useState<Tab>("all");

  // MUST stay memoized on (fanPages, tab). Every branch below except "all" builds a new
  // array, and `rows` is a dependency of the useTopbarExport config memo further down —
  // an unmemoized `rows` hands that memo a fresh identity on every render, which re-fires
  // the effect, re-renders the shared TopbarExportProvider, and re-renders this component:
  // "Maximum update depth exceeded", the exact loop CsvExportRegistrar.tsx documents. It
  // was latent before only because "all" (the default tab, and the stable branch) was the
  // only one anyone had exercised; selecting any other tab froze the screen.
  const rows = useMemo(() => {
    if (tab === "active") {
      // Ranked, NOT filtered. This tab used to drop every page without a post in the last
      // 24h, which on Instagram is almost always every page — the tab was permanently empty
      // and read as broken. Ranking on a 30-day window with a last-posted tiebreak means the
      // ordering is still "most active first" when there is activity, and degrades to
      // "least stale first" when there isn't, instead of showing nothing.
      return [...fanPages].sort(
        (a, b) => b.postsInWindow - a.postsInWindow || (b.lastPostAtMs ?? 0) - (a.lastPostAtMs ?? 0),
      );
    }
    if (tab === "tagged") return fanPages.filter((f) => f.vijayam);
    if (tab === "reach") return [...fanPages].sort((a, b) => b.followersRaw - a.followersRaw);
    return fanPages;
  }, [fanPages, tab]);

  // Both ranked tabs show their position and a bar, so the ordering is visible rather than
  // implied — a sorted list with no ordering cue is indistinguishable from an unsorted one.
  const ranked = tab === "active" || tab === "reach";
  const barMax = Math.max(1, ...rows.map((f) => (tab === "reach" ? f.followersRaw : f.postsInWindow)));

  // Exports whatever the current tab shows, not always the full list — same "export what's
  // on screen" semantics as OwnCampaignsList's search-scoped export.
  const exportConfig = useMemo(
    () => ({
      filename: "fan-pages.csv",
      csv: () =>
        toCsv(
          [
            "Name",
            "Platform",
            "Handle",
            "Followers",
            "Engagement",
            "Posts Today",
            "Posts (30d)",
            "Last Post",
            "Active",
            "Tracked Tag",
            "Verified Fan",
          ],
          rows.map((f) => [
            f.name,
            f.platform,
            f.handle,
            f.followersRaw,
            f.engRaw,
            f.postsTodayRaw,
            f.postsInWindow,
            f.lastPostLabel ?? "",
            f.status ? "yes" : "no",
            f.vijayam ? "yes" : "no",
            f.isVerifiedFan ? "yes" : "no",
          ]),
        ),
    }),
    [rows],
  );
  useTopbarExport(exportConfig);

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
          rows.map((f, i) => {
            const maxSpark = Math.max(1, ...f.spark);
            const barValue = tab === "reach" ? f.followersRaw : f.postsInWindow;
            return (
              <Link className="fan-row" key={f.id} href={`/fan-pages/${f.id}`}>
                {ranked ? <div className={`lb-rank${i < 3 ? ` r${i + 1}` : ""}`}>{i + 1}</div> : null}
                <div className="fan-av" style={{ background: f.bg, color: f.c }}>
                  {f.init}
                </div>
                <div className="fan-info">
                  <div className="fan-name">
                    {f.name} {f.isVerifiedFan ? <Pill kind="fan">Verified fan</Pill> : null}
                  </div>
                  <div className="fan-handle">
                    <span
                      style={{ fontSize: 9, fontWeight: 700, color: platformInk(f.platform), marginRight: 4 }}
                    >
                      {f.platform === "youtube" ? "YT" : "IG"}
                    </span>
                    {f.handle}
                  </div>
                  <div className="fan-stats">
                    <span className="fan-stat">
                      <strong>{f.followers}</strong> followers
                      {f.followerTrendDeltaPct !== null ? (
                        <span
                          style={{
                            marginLeft: 4,
                            fontWeight: 700,
                            color: f.followerTrendDeltaPct >= 0 ? "var(--pencil-green)" : "var(--pencil-red)",
                          }}
                        >
                          {f.followerTrendDeltaPct >= 0 ? "+" : ""}
                          {f.followerTrendDeltaPct}%
                        </span>
                      ) : null}
                    </span>
                    <span className="fan-stat">
                      <strong>{f.eng}</strong> eng
                    </span>
                    <span className="fan-stat">
                      {tab === "active" ? (
                        <>
                          <strong>{f.postsInWindow}</strong> in {f.activityWindowDays}d
                        </>
                      ) : (
                        <>
                          <strong>{f.posts}</strong> today
                        </>
                      )}
                    </span>
                    {tab === "active" ? (
                      <span className="fan-stat">
                        {f.lastPostLabel ? `last ${f.lastPostLabel}` : "no posts yet"}
                      </span>
                    ) : null}
                  </div>
                  {ranked ? (
                    <div className="lb-bar-track" style={{ marginTop: 6 }}>
                      <div
                        className="lb-bar-fill"
                        style={{
                          width: `${Math.round((barValue / barMax) * 100)}%`,
                          background: tab === "reach" ? "var(--series-1)" : "var(--series-2)",
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="fan-right">
                  <div className="mini-spark">
                    {f.spark.map((v, si) => (
                      <div className={`ms-bar${v >= maxSpark ? " mhi" : ""}`} style={{ height: `${v}%` }} key={si} />
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
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}

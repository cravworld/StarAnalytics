"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { ScoutDataTable } from "@/components/scout/ScoutDataTable";
import { formatCount, formatIstDate } from "@/lib/format";
import type { ScoutLeaderboardRow, ScoutRawRow } from "@/lib/data/scout";
import type { ScoutPlatform } from "@prisma/client";

const rankClass = (i: number) => (i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "");
const scoreColor = (s: number) => (s >= 70 ? "var(--pencil-green)" : s >= 40 ? "var(--pencil-amber)" : "var(--pencil-red)");
const profileUrl = (platform: ScoutPlatform, handle: string) =>
  platform === "facebook" ? `https://www.facebook.com/${handle}/` : `https://www.instagram.com/${handle}/`;

const PLATFORM_LABEL: Record<ScoutPlatform, string> = { instagram: "Instagram", facebook: "Facebook" };

export function ScoutLeaderboardFilterable({ rows, rawRows }: { rows: ScoutLeaderboardRow[]; rawRows: ScoutRawRow[] }) {
  const [view, setView] = useState<"leaderboard" | "table">("leaderboard");
  const [search, setSearch] = useState("");
  const [deliverable, setDeliverable] = useState<"all" | "STORY" | "REEL">("all");

  const matches = (handle: string, name: string | null, del: string | null) => {
    if (deliverable !== "all" && del !== deliverable) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return handle.toLowerCase().includes(q) || (name ?? "").toLowerCase().includes(q);
  };

  const filteredRows = useMemo(
    () => rows.filter((r) => matches(r.handle, r.suppliedName, r.deliverable)),
    [rows, search, deliverable],
  );
  const filteredRawRows = useMemo(
    () => rawRows.filter((r) => matches(r.handle, r.suppliedName, r.deliverable)),
    [rawRows, search, deliverable],
  );

  // Batches can mix platforms (a combined Excel upload can carry both Instagram and
  // Facebook links) — scores aren't comparable across platforms (different actors,
  // different weight defaults, Facebook has no per-post reach/engagement data at all), so
  // each platform gets its own independently-ranked section rather than one mixed list.
  // A single-platform batch still shows just its one section, unchanged from before.
  const platformsPresent = useMemo(() => {
    const set = new Set<ScoutPlatform>(rows.map((r) => r.platform));
    const order: ScoutPlatform[] = ["instagram", "facebook"];
    return order.filter((p) => set.has(p));
  }, [rows]);

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`btn ${view === "leaderboard" ? "btn-primary" : ""}`} onClick={() => setView("leaderboard")}>
          Leaderboard
        </button>
        <button className={`btn ${view === "table" ? "btn-primary" : ""}`} onClick={() => setView("table")}>
          Data Table
        </button>
        <input
          placeholder="Search handle or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <select value={deliverable} onChange={(e) => setDeliverable(e.target.value as typeof deliverable)}>
          <option value="all">All deliverables</option>
          <option value="STORY">Story</option>
          <option value="REEL">Reel</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {filteredRows.length} / {rows.length} accounts
        </span>
      </div>

      {view === "leaderboard" ? (
        filteredRows.length === 0 ? (
          <Card title="Buzz Factor Leaderboard">
            <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
              {rows.length === 0 ? "No accounts in this batch." : "No accounts match this filter."}
            </div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {platformsPresent.map((platform) => {
              const sectionRows = filteredRows.filter((r) => r.platform === platform);
              if (sectionRows.length === 0) return null;
              return (
                <Card
                  key={platform}
                  title={
                    platformsPresent.length > 1
                      ? `${PLATFORM_LABEL[platform]} Leaderboard (${sectionRows.length})`
                      : "Buzz Factor Leaderboard"
                  }
                >
                  {sectionRows.map((r, i) => (
                    <div className="lb-row" key={r.candidateId}>
                      <div className={`lb-rank ${rankClass(i)}`}>{r.buzzFactor !== null ? i + 1 : "–"}</div>
                      <div className="lb-body">
                        <div className="lb-name">
                          <a href={profileUrl(r.platform, r.handle)} target="_blank" rel="noreferrer">
                            @{r.handle}
                          </a>
                          {r.suppliedName ? <span style={{ color: "var(--muted)", fontWeight: 400 }}>{r.suppliedName}</span> : null}
                          {r.deliverable ? <Pill kind="default">{r.deliverable}</Pill> : null}
                        </div>
                        {r.buzzFactor !== null ? (
                          <>
                            <div className="lb-bar-track">
                              <div className="lb-bar-fill" style={{ width: `${r.buzzFactor}%`, background: scoreColor(r.buzzFactor) }} />
                            </div>
                            <div className="lb-meta">
                              {r.followers !== null ? <span>Followers <strong>{formatCount(r.followers)}</strong></span> : null}
                              {r.engagementRatePct !== null ? (
                                <span>Engagement <strong>{r.engagementRatePct.toFixed(1)}%</strong></span>
                              ) : null}
                              {r.components ? (
                                <span>
                                  Reach {r.components.reach ?? "–"} · Consistency {r.components.consistency ?? "–"} · Content mix {r.components.contentMix ?? "–"}
                                </span>
                              ) : null}
                              {r.buzzFactorDelta !== null ? (
                                <span style={{ color: r.buzzFactorDelta > 0 ? "var(--pencil-green)" : r.buzzFactorDelta < 0 ? "var(--pencil-red)" : "var(--muted)" }}>
                                  {r.buzzFactorDelta > 0 ? `▲${r.buzzFactorDelta}` : r.buzzFactorDelta < 0 ? `▼${Math.abs(r.buzzFactorDelta)}` : "no change"}
                                  {" "}
                                  since last scan
                                  {r.previousScrapedAt ? ` (${formatIstDate(r.previousScrapedAt, { year: true })})` : ""}
                                </span>
                              ) : null}
                              {r.note ? <span style={{ color: "var(--amber)" }}>{r.note}</span> : null}
                            </div>
                          </>
                        ) : (
                          <div className="lb-meta">Scan in progress…</div>
                        )}
                      </div>
                      {r.buzzFactor !== null ? (
                        <div style={{ textAlign: "right" }}>
                          <div className="lb-score" style={{ color: scoreColor(r.buzzFactor) }}>{r.buzzFactor}</div>
                          {r.buzzFactorDelta !== null && r.buzzFactorDelta !== 0 ? (
                            <div style={{ fontSize: 11, color: r.buzzFactorDelta > 0 ? "var(--pencil-green)" : "var(--pencil-red)" }}>
                              {r.buzzFactorDelta > 0 ? `▲${r.buzzFactorDelta}` : `▼${Math.abs(r.buzzFactorDelta)}`}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        )
      ) : (
        <ScoutDataTable rows={filteredRawRows} />
      )}
    </>
  );
}

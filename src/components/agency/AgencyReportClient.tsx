"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Agency } from "@prisma/client";
import { analyseAgencyPostsAction, getAgencyRunResultsAction } from "@/lib/actions/agency";
import { parseAgencyFile, parsePastedText, type AgencyUrlRow } from "@/lib/upload/parseAgencySheet";
import type { Flag, FlagType } from "@/lib/scoring/types";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { ScreenLoading, ScreenError } from "@/components/ui/ScreenStates";
import { FlagEvidencePanel } from "@/components/agency/FlagEvidencePanel";
import type { AgencyRunResults } from "@/lib/data/agency";
import { toCsv } from "@/lib/csv";
import { useTopbarExport } from "@/components/shell/TopbarExportContext";

type ViewState = "upload" | "progress" | "error" | "results";

const PREVIEW_PALETTE = [
  "#E1306C",
  "#833AB4",
  "#F77737",
  "#1a7a4a",
  "#558b2f",
  "#00838f",
  "#ad1457",
  "#1565c0",
  "#6a1b9a",
  "#4527a0",
];

const FLAG_META: Record<FlagType, { icon: string; title: string; shortLabel: string }> = {
  engagement_velocity_anomaly: { icon: "⚠️", title: "Engagement velocity anomaly", shortLabel: "Velocity" },
  off_hours_engagement_spike: { icon: "🕐", title: "Off-hours engagement spike", shortLabel: "Off-hours" },
  low_save_to_like_ratio: { icon: "👁", title: "Low save-to-like ratio", shortLabel: "Saves" },
  generic_comment_pattern: { icon: "🤖", title: "Generic comment patterns", shortLabel: "Comments" },
};

const scoreColor = (s: number) => (s >= 80 ? "#1a7a4a" : s >= 60 ? "#b45309" : "#b71c1c");
const scoreChipClass = (s: number) => (s >= 80 ? "chip-good" : s >= 65 ? "chip-warn" : "chip-bad");
const rankClass = (i: number) => (i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "");
const severityClass = (s: Flag["severity"]) => (s === "high" ? "red" : "amber");

export function AgencyReportClient({ agencies: dbAgencies }: { agencies: Agency[] }) {
  const [view, setView] = useState<ViewState>("upload");
  const [tab, setTab] = useState<"scores" | "auth" | "posts">("scores");
  const [rows, setRows] = useState<AgencyUrlRow[]>([]);
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<AgencyRunResults | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"score" | "engagement" | "flags">("score");

  const agencyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.agencyName, (counts.get(r.agencyName) ?? 0) + 1);
    return Array.from(counts.entries());
  }, [rows]);

  function mergeRows(parsed: { rows: AgencyUrlRow[]; invalidCount: number }) {
    setRows((prev) => [...prev, ...parsed.rows]);
    setParseNotice(
      parsed.invalidCount > 0
        ? `${parsed.invalidCount} row(s) skipped — not a valid Instagram post/reel URL.`
        : parsed.rows.length > 0
          ? `Added ${parsed.rows.length} link(s).`
          : null,
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    mergeRows(await parseAgencyFile(file));
  }

  function handlePasteBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    if (!text.trim()) return;
    mergeRows(parsePastedText(text));
    e.target.value = "";
  }

  function runAnalysis() {
    if (rows.length === 0) return;
    startTransition(async () => {
      const { runId } = await analyseAgencyPostsAction(rows);
      setRunId(runId);
      setView("progress");
    });
  }

  useEffect(() => {
    if (view !== "progress" || !runId) return;
    let cancelled = false;

    async function poll() {
      const res = await fetch(`/api/agency-run/${runId}/status`);
      const data = await res.json();
      if (cancelled) return;
      if (data.status === "done") {
        const results = await getAgencyRunResultsAction(runId as string);
        if (cancelled) return;
        setResult(results);
        setView("results");
      } else if (data.status === "error") {
        setRunError(data.error ?? "Analysis failed.");
        setView("error");
      }
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, runId]);

  const notEvaluated = useMemo(() => (result ? result.flagRegistry.filter((f) => f.status === "not_evaluated") : []), [result]);

  const flagSummaries = useMemo(() => {
    if (!result) return [];
    const byType = new Map<FlagType, { severity: Flag["severity"]; agencies: Map<string, number> }>();
    for (const p of result.posts) {
      for (const f of p.flags) {
        const entry = byType.get(f.type) ?? { severity: f.severity, agencies: new Map<string, number>() };
        if (f.severity === "high" || entry.severity !== "high") entry.severity = f.severity === "high" ? "high" : entry.severity;
        entry.agencies.set(p.agencyName, (entry.agencies.get(p.agencyName) ?? 0) + 1);
        byType.set(f.type, entry);
      }
    }
    return Array.from(byType.entries()).map(([type, { severity, agencies }]) => ({
      type,
      severity,
      tags: Array.from(agencies.entries()).map(([name, count]) => `${name} · ${count} posts`),
    }));
  }, [result]);

  const filteredPosts = useMemo(() => {
    if (!result) return [];
    let list = result.posts;
    if (agencyFilter !== "all") list = list.filter((p) => p.agencyId === agencyFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.url.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sortKey === "score") sorted.sort((a, b) => b.totalScore - a.totalScore);
    if (sortKey === "engagement") sorted.sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)));
    if (sortKey === "flags") sorted.sort((a, b) => b.flags.length - a.flags.length);
    return sorted;
  }, [result, search, agencyFilter, sortKey]);

  // Memoized against `result`/`filteredPosts` specifically — see OwnCampaignsList.tsx for
  // the full explanation: passing a fresh { filename, csv } object with an unmemoized csv
  // closure on every render defeats useTopbarExport's internal effect entirely, causing an
  // infinite render loop (real "Maximum update depth exceeded" error confirmed live in
  // browser) that froze this page and made every click on it appear to do nothing.
  const exportConfig = useMemo(
    () =>
      result
        ? {
            filename: "agency-report-posts.csv",
            csv: () =>
              toCsv(
                ["URL", "Agency", "Reach", "Likes", "Comments", "Saves", "Auth Score", "Total Score", "Flags"],
                filteredPosts.map((p) => [
                  p.url,
                  p.agencyName,
                  p.reach ?? "",
                  p.likes ?? "",
                  p.comments ?? "",
                  p.saves ?? "",
                  p.authScore,
                  p.totalScore,
                  p.flags.map((f) => f.type).join("; "),
                ]),
              ),
          }
        : null,
    [result, filteredPosts],
  );
  useTopbarExport(exportConfig);

  if (view === "upload") {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Upload Agency Post Links</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Upload a sheet or paste links — one row per post, "Agency Name, Post URL". We&apos;ll scrape and score every link.
            </div>
          </div>
          <button className="btn btn-primary" onClick={runAnalysis} disabled={isPending || rows.length === 0}>
            {isPending ? "Enqueuing…" : `Analyse All Posts (${rows.length}) →`}
          </button>
        </div>
        <div className="g2">
          <div>
            <label className="upload-zone" style={{ display: "block" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                style={{ display: "none" }}
              />
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Drop your sheet here</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Excel or CSV · columns: Agency Name, Post URL
              </div>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 12, fontSize: 12 }}
                onClick={(e) => {
                  // A nested interactive element inside the <label> makes browsers'
                  // click-to-input forwarding unreliable — take over explicitly rather
                  // than relying on it, and stop the label's own forwarding from also
                  // firing (which would open two file dialogs back to back).
                  e.preventDefault();
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Browse file
              </button>
            </label>
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--faint)", margin: "10px 0" }}>
              — or paste links directly —
            </div>
            <textarea
              placeholder={"Agency Name, Post URL — one per line…\nPixelwave Media, https://instagram.com/p/abc123\nReelcraft Agency, https://instagram.com/reel/def456"}
              style={{ width: "100%", height: 100, resize: "none", fontSize: 12 }}
              onBlur={handlePasteBlur}
            />
            {parseNotice ? (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{parseNotice}</div>
            ) : null}
          </div>
          <Card title="Agencies in This Upload">
            {agencyCounts.length === 0 ? (
              dbAgencies.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
                  No links parsed yet — drop a sheet or paste links to get started.
                </div>
              ) : (
                dbAgencies.map((a, i) => (
                  <div className="agency-inp-row" key={a.id}>
                    <div className="ag-num">{i + 1}</div>
                    <div className="ag-dot" style={{ background: a.colourHex }} />
                    <div className="ag-name">{a.name}</div>
                    <div className="ag-links">from a previous run</div>
                  </div>
                ))
              )
            ) : (
              agencyCounts.map(([name, count], i) => (
                <div className="agency-inp-row" key={name}>
                  <div className="ag-num">{i + 1}</div>
                  <div className="ag-dot" style={{ background: PREVIEW_PALETTE[i % PREVIEW_PALETTE.length] }} />
                  <div className="ag-name">{name}</div>
                  <div className="ag-links">{count} link{count === 1 ? "" : "s"}</div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    );
  }

  if (view === "progress") {
    return <ScreenLoading label="Scraping and scoring posts — this can take a few minutes for larger batches…" />;
  }

  if (view === "error") {
    return (
      <div>
        <button className="back-link" onClick={() => setView("upload")}>
          ← Back to Upload
        </button>
        <ScreenError message={runError ?? "Analysis failed."} />
      </div>
    );
  }

  if (!result) return null;

  return (
    <div>
      {selectedFlag ? <FlagEvidencePanel flag={selectedFlag} onClose={() => setSelectedFlag(null)} /> : null}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <button
          className="back-link"
          onClick={() => {
            setView("upload");
            setRows([]);
            setResult(null);
            setRunId(null);
          }}
        >
          ← Back to Upload
        </button>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {result.agencies.length} agencies · {result.summary.postsAnalysed} posts analysed
        </div>
      </div>

      <div className="inner-tabs" style={{ marginBottom: 14 }}>
        <button className={`itab${tab === "scores" ? " active" : ""}`} onClick={() => setTab("scores")}>
          Agency Scorecard
        </button>
        <button className={`itab${tab === "auth" ? " active" : ""}`} onClick={() => setTab("auth")}>
          Authenticity Audit
        </button>
        <button className={`itab${tab === "posts" ? " active" : ""}`} onClick={() => setTab("posts")}>
          All Posts
        </button>
      </div>

      {tab === "scores" ? (
        <div>
          <KpiGrid cols={5}>
            <Kpi label="Posts Analysed" value={String(result.summary.postsAnalysed)} delta={`${result.agencies.length} agencies`} />
            <Kpi label="Total Engagement" value={result.summary.totalEngagement} delta="Likes + comments" deltaDirection="up" />
            <Kpi label="Avg Engagement/Post" value={result.summary.avgEngagementPerPost} delta="All posts" />
            <Kpi
              label="Authenticity"
              value={`${result.summary.avgAuthenticity}%`}
              valueColor="var(--amber)"
              delta={`${result.summary.flaggedAgencies} agencies flagged`}
            />
            {result.summary.topAgency ? (
              <Kpi label="Top Agency" value={result.summary.topAgency.name} delta={`Score ${result.summary.topAgency.score}/100`} deltaDirection="up" compact />
            ) : (
              <Kpi label="Top Agency" value="—" delta="No scores yet" compact />
            )}
          </KpiGrid>

          <div className="g-6-4">
            <Card title="Agency Leaderboard — Overall Score">
              {result.agencies.map((a, i) => (
                <div className="lb-row" key={a.id}>
                  <div className={`lb-rank ${rankClass(i)}`}>{i + 1}</div>
                  <div className="lb-body">
                    <div className="lb-name">
                      <span className="dot" style={{ background: a.color }} />
                      {a.name}
                      {a.flaggedPostCount > 0 ? <span className="flag-chip">{a.flaggedPostCount} flagged</span> : null}
                    </div>
                    <div className="lb-bar-track">
                      <div className="lb-bar-fill" style={{ width: `${a.score}%`, background: scoreColor(a.score) }} />
                    </div>
                    <div className="lb-meta">
                      <span>Engagement <strong>{a.engagementTotal}</strong></span>
                      <span>Auth <strong style={{ color: scoreColor(a.auth) }}>{a.auth}</strong></span>
                      <span title="Not evaluated — no reach/spend data this phase">Eff <strong style={{ color: "var(--faint)" }}>—</strong></span>
                    </div>
                  </div>
                  <div className="lb-score" style={{ color: scoreColor(a.score) }}>{a.score}</div>
                </div>
              ))}
            </Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Card title="Score Components">
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 4 }}>
                    <span>Performance (62.5% of score)</span>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>Engagement vs. campaign cohort</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 4 }}>
                    <span>Authenticity (37.5% of score)</span>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>Velocity + off-hours flags</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Efficiency (0% of score)</span>
                    <span style={{ color: "var(--faint)", fontWeight: 600 }}>Not evaluated</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 8, color: "var(--faint)" }}>
                    Efficiency&apos;s nominal DPR weight is 20%, but no reach, follower, or spend data exists
                    for scraped third-party posts, so there is no efficiency signal independent of
                    performance this phase. Rather than blend in a placeholder number, it is excluded from
                    the total and performance/authenticity are renormalized to 62.5% / 37.5% (their 50/30
                    split rescaled to sum to 100%).
                  </div>
                </div>
              </Card>
              <Card title="Campaign Health">
                {[
                  { label: "Avg authenticity", value: result.summary.avgAuthenticity, color: "var(--amber)" },
                  { label: "Avg performance", value: result.summary.avgPerformance, color: "var(--green)" },
                ].map((row) => (
                  <div style={{ marginBottom: 10 }} key={row.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--muted)" }}>{row.label}</span>
                      <span style={{ fontWeight: 700, color: row.color }}>{row.value}/100</span>
                    </div>
                    <div style={{ height: 6, background: "#f0f0f5", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${row.value}%`, height: "100%", background: row.color, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }} title="Not evaluated — no reach/spend data this phase">
                  <span style={{ color: "var(--muted)" }}>Avg efficiency</span>
                  <span style={{ fontWeight: 700, color: "var(--faint)" }}>Not evaluated</span>
                </div>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "auth" ? (
        <div>
          <KpiGrid cols={4}>
            <Kpi label="Flagged Posts" value={String(result.posts.filter((p) => p.flags.length > 0).length)} valueColor="var(--red)" delta={`of ${result.posts.length} posts`} />
            <Kpi label="Flagged Agencies" value={String(result.summary.flaggedAgencies)} valueColor="var(--amber)" delta={`of ${result.agencies.length} agencies`} />
            <Kpi label="Avg Authenticity" value={`${result.summary.avgAuthenticity}%`} valueColor="var(--green)" />
            <Kpi label="Clean Agencies" value={`${result.agencies.length - result.summary.flaggedAgencies}/${result.agencies.length}`} valueColor="var(--green)" delta="No flags raised" deltaDirection="up" />
          </KpiGrid>
          <div className="g2">
            <Card title="Red Flags Detected">
              {flagSummaries.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>No flags fired this run.</div>
              ) : (
                flagSummaries.map((f) => (
                  <div className={`flag-row ${severityClass(f.severity)}`} style={{ marginTop: 6 }} key={f.type}>
                    <div className="flag-ico">{FLAG_META[f.type].icon}</div>
                    <div className="flag-body">
                      <div className="flag-title">{FLAG_META[f.type].title}</div>
                      <div className="flag-tags">
                        {f.tags.map((t) => (
                          <span className={`pill pill-${f.severity === "high" ? "bad" : "warn"}`} key={t}>{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div className="card-title" style={{ marginBottom: 8 }}>Not Evaluated This Phase</div>
                {notEvaluated.map((f) => (
                  <div className="flag-row" style={{ background: "#f0f0f0", marginTop: 6 }} key={f.type}>
                    <div className="flag-ico">{FLAG_META[f.type].icon}</div>
                    <div className="flag-body">
                      <div className="flag-title" style={{ color: "var(--muted)" }}>{FLAG_META[f.type].title}</div>
                      <div className="flag-desc">{f.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Authenticity Score per Agency">
              {result.agencies.map((a) => (
                <div className="auth-row" key={a.id}>
                  <span className="dot" style={{ background: a.color }} />
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{a.name}</div>
                  <div className="auth-bar-track">
                    <div className="auth-bar-fill" style={{ width: `${a.auth}%`, background: scoreColor(a.auth) }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor(a.auth), width: 26, textAlign: "right" }}>{a.auth}</div>
                  {a.flaggedPostCount > 0 ? (
                    <span className={`pill pill-${a.auth < 60 ? "bad" : "warn"}`}>{a.flaggedPostCount} flagged</span>
                  ) : (
                    <span className="pill pill-good">Clean</span>
                  )}
                </div>
              ))}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "posts" ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input
              placeholder="Search URL…"
              style={{ flex: 1, minWidth: 160 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)}>
              <option value="all">All agencies</option>
              {result.agencies.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
              <option value="score">Sort: Score (high)</option>
              <option value="engagement">Sort: Engagement</option>
              <option value="flags">Sort: Flags</option>
            </select>
          </div>
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table className="post-tbl">
              <thead>
                <tr>
                  <th>#</th><th>Post URL</th><th>Agency</th><th>Reach</th><th>Likes</th>
                  <th>Comments</th><th>Saves</th><th>Auth</th><th>Score</th><th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {filteredPosts.map((p, i) => (
                  <tr key={p.id}>
                    <td style={{ color: "var(--faint)" }}>{i + 1}</td>
                    <td>
                      <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 11 }}>
                        {p.url.replace(/^https?:\/\//, "")}
                      </a>
                    </td>
                    <td><span className="dot" style={{ background: p.agencyColor, marginRight: 5 }} />{p.agencyName}</td>
                    <td>{p.reach ?? "—"}</td>
                    <td>{p.likes ?? "—"}</td>
                    <td>{p.comments ?? "—"}</td>
                    <td>{p.saves ?? "—"}</td>
                    <td style={{ fontWeight: 700, color: scoreColor(p.authScore) }}>{p.authScore}</td>
                    <td><span className={`score-chip ${scoreChipClass(p.totalScore)}`}>{Math.round(p.totalScore)}</span></td>
                    <td>
                      {p.flags.map((f, fi) => (
                        <button
                          key={fi}
                          className="flag-chip"
                          style={{ cursor: "pointer", border: "none" }}
                          onClick={() => setSelectedFlag(f)}
                          title="Click to view evidence"
                        >
                          {FLAG_META[f.type].shortLabel}
                        </button>
                      ))}
                      {notEvaluated.map((f) => (
                        <span
                          key={f.type}
                          className="flag-chip"
                          style={{ background: "#eee", color: "var(--faint)" }}
                          title={f.reason}
                        >
                          {FLAG_META[f.type].shortLabel}: N/A
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--faint)", marginTop: 10, padding: 8 }}>
            Showing {filteredPosts.length} of {result.posts.length} posts
          </div>
        </div>
      ) : null}
    </div>
  );
}

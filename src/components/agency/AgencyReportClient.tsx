"use client";

import { useState, useTransition } from "react";
import { analyseAgencyPostsAction } from "@/lib/actions/agency";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { ScreenLoading } from "@/components/ui/ScreenStates";
import type { AGENCIES } from "@/lib/providers/seed";

type Agencies = typeof AGENCIES;
type AnalysisResult = Awaited<ReturnType<typeof analyseAgencyPostsAction>>;

const scoreColor = (s: number) => (s >= 80 ? "#1a7a4a" : s >= 60 ? "#b45309" : "#b71c1c");
const scoreChipClass = (s: number) => (s >= 80 ? "chip-good" : s >= 65 ? "chip-warn" : "chip-bad");
const rankClass = (i: number) => (i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "");

export function AgencyReportClient({ agencies }: { agencies: Agencies }) {
  const [view, setView] = useState<"upload" | "results">("upload");
  const [tab, setTab] = useState<"scores" | "auth" | "posts">("scores");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAnalysis() {
    startTransition(async () => {
      const data = await analyseAgencyPostsAction();
      setResult(data);
      setView("results");
    });
  }

  if (view === "upload") {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Upload Agency Post Links</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Upload a sheet or paste links for each agency. We&apos;ll scrape and score all 500 posts.
            </div>
          </div>
          <button className="btn btn-primary" onClick={runAnalysis} disabled={isPending}>
            {isPending ? "Analysing…" : "Analyse All Posts →"}
          </button>
        </div>
        <div className="g2">
          <div>
            <div className="upload-zone" onClick={runAnalysis}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Drop your sheet here</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Excel or CSV · one row per link · agency column</div>
              <button className="btn" style={{ marginTop: 12, fontSize: 12 }}>Browse file</button>
            </div>
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--faint)", margin: "10px 0" }}>
              — or paste links directly —
            </div>
            <textarea
              placeholder={"Paste Instagram post URLs, one per line…\nhttps://instagram.com/p/abc123\nhttps://instagram.com/p/def456"}
              style={{ width: "100%", height: 100, resize: "none", fontSize: 12 }}
            />
          </div>
          <Card title="Agencies in This Campaign">
            {agencies.map((a, i) => (
              <div className="agency-inp-row" key={a.name}>
                <div className="ag-num">{i + 1}</div>
                <div className="ag-dot" style={{ background: a.color }} />
                <div className="ag-name">{a.name}</div>
                <div className="ag-links">50 links</div>
              </div>
            ))}
            <div className="add-btn" style={{ marginTop: 10, marginBottom: 0 }}>＋ Add Agency</div>
          </Card>
        </div>
        {isPending ? <ScreenLoading label="Enqueuing scrape + scoring run…" /> : null}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <button className="back-link" onClick={() => setView("upload")}>
          ← Back to Upload
        </button>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {agencies.length} agencies · {result.summary.postsAnalysed} posts analysed · BKU campaign
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
          All 500 Posts
        </button>
      </div>

      {tab === "scores" ? (
        <div>
          <KpiGrid cols={5}>
            <Kpi label="Posts Analysed" value={String(result.summary.postsAnalysed)} delta={`${agencies.length} agencies`} />
            <Kpi label="Total Reach" value={result.summary.totalReach} delta="Campaign total" deltaDirection="up" />
            <Kpi label="Avg Engagement" value={result.summary.avgEngagement} delta="All posts" />
            <Kpi
              label="Authenticity"
              value={`${result.summary.authenticityPct}%`}
              valueColor="var(--amber)"
              delta={`${result.summary.flaggedAgencies} agencies flagged`}
            />
            <Kpi label="Top Agency" value={result.summary.topAgency.name} delta={`Score ${result.summary.topAgency.score}/100`} deltaDirection="up" />
          </KpiGrid>

          <div className="g-6-4">
            <Card title="Agency Leaderboard — Overall Score">
              {agencies.map((a, i) => (
                <div className="lb-row" key={a.name}>
                  <div className={`lb-rank ${rankClass(i)}`}>{i + 1}</div>
                  <div className="lb-body">
                    <div className="lb-name">
                      <span className="dot" style={{ background: a.color }} />
                      {a.name}
                      {a.flags > 0 ? <span className="flag-chip">{a.flags} flags</span> : null}
                    </div>
                    <div className="lb-bar-track">
                      <div className="lb-bar-fill" style={{ width: `${a.score}%`, background: scoreColor(a.score) }} />
                    </div>
                    <div className="lb-meta">
                      <span>Reach <strong>{a.reach}</strong></span>
                      <span>Auth <strong style={{ color: scoreColor(a.auth) }}>{a.auth}</strong></span>
                      <span>Eff <strong>{a.eff}</strong></span>
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
                    <span>Performance (50%)</span>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>Reach · likes · comments · saves</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 4 }}>
                    <span>Authenticity (30%)</span>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>Real eng · bot detection</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Efficiency (20%)</span>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>Reach/post · consistency</span>
                  </div>
                </div>
              </Card>
              <Card title="Campaign Health">
                {[
                  { label: "Avg authenticity", value: result.summary.avgAuthenticity, color: "var(--amber)" },
                  { label: "Avg performance", value: result.summary.avgPerformance, color: "var(--green)" },
                  { label: "Avg efficiency", value: result.summary.avgEfficiency, color: "var(--blue)" },
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
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "auth" ? (
        <div>
          <KpiGrid cols={4}>
            <Kpi label="Suspicious Posts" value="37" valueColor="var(--red)" delta="7.4% of 500 posts" />
            <Kpi label="Bot-like Engagement" value="3 agencies" valueColor="var(--amber)" delta="Influx, BuzzBridge, NovaSocial" />
            <Kpi label="Comment Quality" value="82%" valueColor="var(--green)" delta="Genuine comments" deltaDirection="up" />
            <Kpi label="Clean Agencies" value="7/10" valueColor="var(--green)" delta="No flags raised" deltaDirection="up" />
          </KpiGrid>
          <div className="g2">
            <Card title="Red Flags Detected">
              {result.authFlags.map((f) => (
                <div className={`flag-row ${f.severity}`} style={{ marginTop: 6 }} key={f.title}>
                  <div className="flag-ico">{f.icon}</div>
                  <div className="flag-body">
                    <div className="flag-title">{f.title}</div>
                    <div className="flag-desc">{f.desc}</div>
                    <div className="flag-tags">
                      {f.tags.map((t) => (
                        <span className={`pill pill-${f.severity === "red" ? "bad" : "warn"}`} key={t}>{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
            <Card title="Authenticity Score per Agency">
              {agencies.map((a) => (
                <div className="auth-row" key={a.name}>
                  <span className="dot" style={{ background: a.color }} />
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{a.name}</div>
                  <div className="auth-bar-track">
                    <div className="auth-bar-fill" style={{ width: `${a.auth}%`, background: scoreColor(a.auth) }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor(a.auth), width: 26, textAlign: "right" }}>{a.auth}</div>
                  {a.flags > 0 ? (
                    <span className={`pill pill-${a.auth < 60 ? "bad" : "warn"}`}>{a.flags} flags</span>
                  ) : (
                    <span className="pill pill-good">Clean</span>
                  )}
                </div>
              ))}
            </Card>
          </div>
          <Card title="Positive Signals — What's Genuine">
            <div className="g3" style={{ marginBottom: 0 }}>
              {result.positiveSignals.map((s) => (
                <div className="flag-row green-bg" style={{ flexDirection: "column", gap: 4 }} key={s.title}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{s.icon}</span>
                    <div className="flag-title">{s.title}</div>
                  </div>
                  <div className="flag-desc">{s.desc}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "posts" ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input placeholder="Search URL or caption…" style={{ flex: 1, minWidth: 160 }} />
            <select>
              <option>All agencies</option>
              {agencies.map((a) => (
                <option key={a.name}>{a.name}</option>
              ))}
            </select>
            <select>
              <option>Sort: Score (high)</option>
              <option>Sort: Reach</option>
              <option>Sort: Engagement</option>
              <option>Sort: Flags</option>
            </select>
          </div>
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table className="post-tbl">
              <thead>
                <tr>
                  <th>#</th><th>Post URL</th><th>Agency</th><th>Reach</th><th>Likes</th>
                  <th>Comments</th><th>Saves</th><th>Eng%</th><th>Auth</th><th>Score</th><th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {result.posts.map((p, i) => (
                  <tr key={p.url}>
                    <td style={{ color: "var(--faint)" }}>{i + 1}</td>
                    <td><a href="#" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 11 }}>{p.url}</a></td>
                    <td><span className="dot" style={{ background: p.color, marginRight: 5 }} />{p.ag}</td>
                    <td>{p.reach}</td><td>{p.likes}</td><td>{p.comments}</td><td>{p.saves}</td>
                    <td style={{ fontWeight: 700 }}>{p.eng}</td>
                    <td style={{ fontWeight: 700, color: scoreColor(p.auth) }}>{p.auth}</td>
                    <td><span className={`score-chip ${scoreChipClass(p.score)}`}>{p.score}</span></td>
                    <td>
                      {p.flags.length ? (
                        p.flags.map((f) => <span className="flag-chip" key={f}>{f}</span>)
                      ) : (
                        <span style={{ color: "var(--green)", fontSize: 12 }}>✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--faint)", marginTop: 10, padding: 8 }}>
            Showing {result.posts.length} of 500 posts · sorted by score
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Pill, LiveDot } from "@/components/ui/Pill";
import { toCsv } from "@/lib/csv";
import { useTopbarExport } from "@/components/shell/TopbarExportContext";
import type { getOwnCampaigns } from "@/lib/data/campaigns";

type Campaign = Awaited<ReturnType<typeof getOwnCampaigns>>["campaigns"][number];
type Kpis = Awaited<ReturnType<typeof getOwnCampaigns>>["kpis"];

export function OwnCampaignsList({ campaigns, kpis }: { campaigns: Campaign[]; kpis: Kpis }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q));
  }, [campaigns, query]);

  // Memoized against `filtered` specifically — passing a fresh { filename, csv } object
  // (with an inline, unmemoized csv closure) on every render used to defeat
  // useTopbarExport's internal useCallback/useEffect entirely: csv's identity changed on
  // every render regardless of whether `filtered` actually changed, so the effect fired
  // every render, called setConfig in the shared TopbarExportProvider, which re-rendered
  // this component, which created a new csv closure again — an infinite render loop
  // (real symptom: React's "Maximum update depth exceeded", confirmed live in-browser,
  // which froze the page and made every click on this screen appear to do nothing).
  const exportConfig = useMemo(
    () => ({
      filename: "own-campaigns.csv",
      csv: () =>
        toCsv(
          ["Name", "Status", "Details", "Posts", "Engagement"],
          filtered.map((c) => [c.name, c.status, c.meta, c.postCount, c.engagement]),
        ),
    }),
    [filtered],
  );
  useTopbarExport(exportConfig);

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          placeholder="Search campaigns…"
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Link href="/campaigns/new" className="btn btn-primary">
          ＋ New Campaign
        </Link>
      </div>

      <KpiGrid cols={3}>
        <Kpi label="Active Campaigns" value={String(kpis.active)} delta="Live now" />
        <Kpi label="Total Engagement" value={kpis.totalHashtagReach} delta="All campaigns" />
        <Kpi label="Hashtags Tracked" value={String(kpis.hashtagsTracked)} delta="Across campaigns" />
      </KpiGrid>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          {campaigns.length === 0 ? "No campaigns yet." : "No campaigns match your search."}
        </div>
      ) : (
        filtered.map((c) => (
          <Link href={`/campaigns/${c.id}`} className="campaign-card" key={c.id}>
            <div className="camp-icon" style={{ background: c.iconBg }}>
              {c.icon}
            </div>
            <div className="camp-body">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <div className="camp-name">{c.name}</div>
                {c.status === "live" ? (
                  <Pill kind="live">
                    <LiveDot /> Live
                  </Pill>
                ) : (
                  <Pill kind="planned">Planned</Pill>
                )}
              </div>
              <div className="camp-meta">{c.meta}</div>
              {c.stats.length > 0 ? (
                <div className="camp-stats">
                  {c.stats.map((s) => (
                    <span className="cstat" key={s.label}>
                      <strong>{s.value}</strong> {s.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <span style={{ color: "var(--faint)", fontSize: 18, marginTop: 2 }}>›</span>
          </Link>
        ))
      )}
    </>
  );
}

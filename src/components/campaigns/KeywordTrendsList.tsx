"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";
import type { KeywordTrendsResult } from "@/lib/data/keywords";
import { useTopbarExport } from "@/components/shell/TopbarExportContext";
import { toCsv } from "@/lib/csv";

const SENTIMENT_COLOR = { pos: "#1a7a4a", neu: "#bdbdbd", neg: "#c62828" } as const;

function SentimentMixBar({ positivePct, neutralPct, negativePct }: { positivePct: number; neutralPct: number; negativePct: number }) {
  return (
    <div style={{ display: "flex", width: 90, height: 6, borderRadius: 3, overflow: "hidden", background: "var(--track)" }}>
      <div style={{ width: `${positivePct}%`, background: SENTIMENT_COLOR.pos }} />
      <div style={{ width: `${neutralPct}%`, background: SENTIMENT_COLOR.neu }} />
      <div style={{ width: `${negativePct}%`, background: SENTIMENT_COLOR.neg }} />
    </div>
  );
}

export function KeywordTrendsList({ data }: { data: KeywordTrendsResult }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.keywords;
    return data.keywords.filter((k) => k.keyword.includes(q));
  }, [data.keywords, query]);

  const exportConfig = useMemo(
    () => ({
      filename: "keyword-trends.csv",
      csv: () =>
        toCsv(
          ["Keyword", "Posts", "Positive %", "Neutral %", "Negative %"],
          filtered.map((k) => [k.keyword, k.count, k.positivePct, k.neutralPct, k.negativePct]),
        ),
    }),
    [filtered],
  );
  useTopbarExport(exportConfig);

  function onCampaignChange(id: string) {
    router.push(id ? `/campaigns/keywords?campaign=${id}` : "/campaigns/keywords");
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          placeholder="Filter keywords…"
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={data.campaignId ?? ""} onChange={(e) => onCampaignChange(e.target.value)}>
          <option value="">All Campaigns</option>
          {data.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <KpiGrid cols={3}>
        <Kpi label="Classified Posts" value={String(data.totalClassifiedPosts)} delta="In this view" />
        <Kpi label="Keywords Tracked" value={String(data.keywords.length)} delta="Top 30 shown" />
        <Kpi label="Top Keyword" value={data.keywords[0]?.keyword ?? "—"} compact />
      </KpiGrid>

      <Card title="Trending Topics">
        {data.totalClassifiedPosts === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
            No classified posts yet — keywords appear here once sentiment analysis has run.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No keywords match your filter.</div>
        ) : (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 11,
                color: "var(--muted)",
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1 }}>Keyword</div>
              <div style={{ width: 50, textAlign: "right" }}>Posts</div>
              <div style={{ width: 90 }}>Sentiment mix</div>
              <div style={{ width: 90 }}>Last {14} days</div>
            </div>
            {filtered.map((k) => (
              <div
                key={k.keyword}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <div style={{ flex: 1, fontWeight: 600 }}>{k.keyword}</div>
                <div style={{ width: 50, textAlign: "right", color: "var(--muted)" }}>{k.count}</div>
                <div style={{ width: 90 }}>
                  <SentimentMixBar positivePct={k.positivePct} neutralPct={k.neutralPct} negativePct={k.negativePct} />
                </div>
                <div style={{ width: 90 }}>
                  <Sparkline values={k.sparkline} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

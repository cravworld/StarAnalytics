"use client";

import "./register";
import { Line } from "react-chartjs-2";
import type { SentimentTrendPoint } from "@/lib/data/campaigns";
import type { CampaignEventRow } from "@/lib/data/campaignEvents";

// events is optional and defaults to [] — every existing caller of this component predates
// the timeline feature and shouldn't have to change to keep compiling.
export function SentimentTrendLine({ data, events = [] }: { data: SentimentTrendPoint[]; events?: CampaignEventRow[] }) {
  const labels = data.map((d) => new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }));

  // Best-effort only: this can only mark a day that already has a classified-post data
  // point (sentimentTrend is sparse by design, see getCampaignDetail) — an event on a day
  // with zero classified posts has nothing to attach to and simply won't show a marker
  // here. The Campaign Timeline list above the chart is the source of truth for every
  // logged event regardless of whether it lands on a plotted day.
  const eventsByDate = new Map<string, string[]>();
  for (const e of events) {
    const list = eventsByDate.get(e.eventDate) ?? [];
    list.push(e.label);
    eventsByDate.set(e.eventDate, list);
  }
  const pointRadius = data.map((d) => (eventsByDate.has(d.date) ? 6 : 3));
  const pointBackgroundColor = data.map((d) => (eventsByDate.has(d.date) ? "#E1306C" : "#1a7a4a"));

  return (
    <div className="chart-wrap">
      <Line
        data={{
          labels,
          datasets: [
            {
              data: data.map((d) => d.positivePct),
              borderColor: "#1a7a4a",
              backgroundColor: "rgba(26,122,74,.08)",
              fill: true,
              tension: 0.4,
              pointRadius,
              borderWidth: 2,
              pointBackgroundColor,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const point = data[ctx.dataIndex];
                  const dayEvents = eventsByDate.get(point.date);
                  const base = `${ctx.parsed.y}% positive (${point.classified} classified)`;
                  return dayEvents ? `${base} — ${dayEvents.join(", ")}` : base;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#72728a" } },
            y: {
              min: 0,
              max: 100,
              grid: { color: "rgba(0,0,0,.05)" },
              ticks: { color: "#72728a", callback: (v) => `${v}%` },
            },
          },
        }}
      />
    </div>
  );
}

"use client";

import "./register";
import { Line } from "react-chartjs-2";
import type { SentimentTrendPoint } from "@/lib/data/campaigns";
import type { CampaignEventRow } from "@/lib/data/campaignEvents";
import { PENCIL_GREEN, GREEN_FILL, INK, LEAF, GRIDLINE, tickFont } from "./theme";
import { formatIstDate } from "@/lib/format";

// events is optional and defaults to [] — every existing caller of this component predates
// the timeline feature and shouldn't have to change to keep compiling.
export function SentimentTrendLine({ data, events = [] }: { data: SentimentTrendPoint[]; events?: CampaignEventRow[] }) {
  const labels = data.map((d) => formatIstDate(d.date));

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
  // An event marker is an annotation, not a judgement, so it is drawn in plain INK
  // rather than the alert red it used to use — a red dot on a sentiment line reads as
  // "something went wrong here", which is not what logging an event means.
  const pointBackgroundColor = data.map((d) => (eventsByDate.has(d.date) ? INK : PENCIL_GREEN));

  return (
    <div className="chart-wrap">
      <Line
        data={{
          labels,
          datasets: [
            {
              data: data.map((d) => d.positivePct),
              // The one chart that keeps a semantic colour rather than the neutral ink:
              // the quantity plotted IS positive sentiment, so green carries meaning here.
              borderColor: PENCIL_GREEN,
              backgroundColor: GREEN_FILL,
              fill: true,
              tension: 0.4,
              pointRadius,
              borderWidth: 2,
              pointBackgroundColor,
              // A paper-coloured ring keeps each point legible where the line doubles
              // back over its own fill, and separates the larger event markers cleanly.
              pointBorderColor: LEAF,
              pointBorderWidth: 1,
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
            x: { grid: { display: false }, ticks: { font: tickFont() } },
            y: {
              min: 0,
              max: 100,
              grid: { color: GRIDLINE },
              border: { display: false },
              ticks: { font: tickFont(), callback: (v) => `${v}%` },
            },
          },
        }}
      />
    </div>
  );
}

"use client";

import "./register";
import { Line } from "react-chartjs-2";
import type { SentimentTrendPoint } from "@/lib/data/campaigns";

export function SentimentTrendLine({ data }: { data: SentimentTrendPoint[] }) {
  const labels = data.map((d) => new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
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
              pointRadius: 3,
              borderWidth: 2,
              pointBackgroundColor: "#1a7a4a",
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
                label: (ctx) => `${ctx.parsed.y}% positive (${data[ctx.dataIndex].classified} classified)`,
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

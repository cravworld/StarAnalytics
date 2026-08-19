"use client";

import "./register";
import { Line } from "react-chartjs-2";
import { INK, INK_FILL, GRIDLINE, tickFont } from "./theme";

export function GrowthChart({ data }: { data: number[] }) {
  const labels = data.map((_, i) => `W${i + 1}`);
  return (
    <div className="chart-wrap">
      <Line
        data={{
          labels,
          datasets: [
            {
              data,
              // A single series is drawn with the single pen. Ink, not a tint —
              // this line IS the data, and the design system reserves pale tones
              // for structure.
              borderColor: INK,
              backgroundColor: INK_FILL,
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            // Tick colour/size come from the shared Chart.js defaults in
            // ./register — the old #b0b0c8 was ~2.1:1 on white and unreadable.
            x: {
              grid: { display: false },
              ticks: { maxRotation: 0, autoSkipPadding: 16, font: tickFont() },
            },
            y: {
              grid: { color: GRIDLINE },
              border: { display: false },
              ticks: {
                maxTicksLimit: 5,
                font: tickFont(),
                // Values arrive in thousands. Past 1000 the old `${v}K` callback
                // rendered follower counts as "7450K"; nobody reads a dashboard in
                // thousands-of-thousands.
                callback: (v) => {
                  const k = Number(v);
                  return k >= 1000 ? `${(k / 1000).toFixed(2)}M` : `${k}K`;
                },
              },
            },
          },
        }}
      />
    </div>
  );
}

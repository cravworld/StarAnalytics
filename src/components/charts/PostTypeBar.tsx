"use client";

import "./register";
import { Bar } from "react-chartjs-2";
import { SERIES, INK, GRIDLINE, tickFont } from "./theme";

export function PostTypeBar({ data }: { data: { label: string; engagementPct: number }[] }) {
  return (
    <div className="chart-wrap">
      <Bar
        data={{
          labels: data.map((d) => d.label),
          datasets: [
            {
              label: "Avg Eng %",
              data: data.map((d) => d.engagementPct),
              // Ordered categories take the sequential ramp. The ink hairline is
              // what makes the lightest step safe: a pencil fill inside a pen
              // outline, so every bar has a hard edge against the card regardless
              // of how pale its fill is.
              backgroundColor: data.map((_, i) => SERIES[i % SERIES.length]),
              borderColor: INK,
              borderWidth: 1,
              borderRadius: 2,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: tickFont() } },
            y: {
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

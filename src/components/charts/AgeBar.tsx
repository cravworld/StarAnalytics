"use client";

import "./register";
import { Bar } from "react-chartjs-2";
import { SERIES, INK, GRIDLINE, tickFont } from "./theme";

export function AgeBar({ data }: { data: { bracket: string; pct: number }[] }) {
  return (
    <div className="chart-wrap">
      <Bar
        data={{
          labels: data.map((d) => d.bracket),
          datasets: [
            {
              data: data.map((d) => d.pct),
              // One series, one pressure. The old fill was a 70%-alpha tint, which
              // put the actual data below the contrast floor this system holds
              // every mark to; SERIES[1] is a solid 8.95:1.
              backgroundColor: SERIES[1],
              borderColor: INK,
              borderWidth: 1,
              borderRadius: 2,
            },
          ],
        }}
        options={{
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              grid: { color: GRIDLINE },
              border: { display: false },
              ticks: { font: tickFont(), callback: (v) => `${v}%` },
            },
            y: { grid: { display: false }, ticks: { font: tickFont() } },
          },
        }}
      />
    </div>
  );
}

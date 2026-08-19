"use client";

import "./register";
import { Line } from "react-chartjs-2";
import { INK, INK_FILL, LEAF, GRIDLINE, tickFont } from "./theme";

export function ReachLine({ data }: { data: number[] }) {
  const labels = data.map((_, i) => `W${i + 1}`);
  return (
    <div className="chart-wrap">
      <Line
        data={{
          labels,
          datasets: [
            {
              data,
              borderColor: INK,
              backgroundColor: INK_FILL,
              fill: true,
              tension: 0.4,
              pointRadius: 3,
              borderWidth: 2,
              pointBackgroundColor: INK,
              // A paper-coloured ring keeps each point legible where the line
              // doubles back over its own fill.
              pointBorderColor: LEAF,
              pointBorderWidth: 1,
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
              ticks: { font: tickFont(), callback: (v) => `${v}M` },
            },
          },
        }}
      />
    </div>
  );
}

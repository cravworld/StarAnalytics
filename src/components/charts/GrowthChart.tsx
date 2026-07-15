"use client";

import "./register";
import { Line } from "react-chartjs-2";

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
              borderColor: "#E1306C",
              backgroundColor: "rgba(225,48,108,.08)",
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
            x: { grid: { display: false }, ticks: { color: "#b0b0c8", font: { size: 10 } } },
            y: {
              grid: { color: "rgba(0,0,0,.05)" },
              ticks: { color: "#b0b0c8", font: { size: 10 }, callback: (v) => `${v}K` },
            },
          },
        }}
      />
    </div>
  );
}

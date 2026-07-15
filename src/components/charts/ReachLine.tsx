"use client";

import "./register";
import { Line } from "react-chartjs-2";

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
              borderColor: "#833AB4",
              backgroundColor: "rgba(131,58,180,.08)",
              fill: true,
              tension: 0.4,
              pointRadius: 3,
              borderWidth: 2,
              pointBackgroundColor: "#833AB4",
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#72728a" } },
            y: {
              grid: { color: "rgba(0,0,0,.05)" },
              ticks: { color: "#72728a", callback: (v) => `${v}M` },
            },
          },
        }}
      />
    </div>
  );
}

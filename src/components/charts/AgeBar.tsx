"use client";

import "./register";
import { Bar } from "react-chartjs-2";

export function AgeBar({ data }: { data: { bracket: string; pct: number }[] }) {
  return (
    <div className="chart-wrap">
      <Bar
        data={{
          labels: data.map((d) => d.bracket),
          datasets: [
            {
              data: data.map((d) => d.pct),
              backgroundColor: "rgba(225,48,108,.7)",
              borderRadius: 5,
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
              grid: { color: "rgba(0,0,0,.05)" },
              ticks: { color: "#72728a", callback: (v) => `${v}%` },
            },
            y: { grid: { display: false }, ticks: { color: "#72728a" } },
          },
        }}
      />
    </div>
  );
}

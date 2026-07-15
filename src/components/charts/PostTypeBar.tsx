"use client";

import "./register";
import { Bar } from "react-chartjs-2";

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
              backgroundColor: ["#E1306C", "#833AB4", "#F77737", "#1a7a4a"],
              borderRadius: 5,
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
              ticks: { color: "#72728a", callback: (v) => `${v}%` },
            },
          },
        }}
      />
    </div>
  );
}

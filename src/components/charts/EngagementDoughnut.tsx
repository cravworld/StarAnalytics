"use client";

import "./register";
import { Doughnut } from "react-chartjs-2";

export function EngagementDoughnut({
  data,
}: {
  data: { likes: number; comments: number; saves: number; shares: number };
}) {
  return (
    <div className="chart-wrap">
      <Doughnut
        data={{
          labels: ["Likes", "Comments", "Saves", "Shares"],
          datasets: [
            {
              data: [data.likes, data.comments, data.saves, data.shares],
              backgroundColor: ["#E1306C", "#833AB4", "#F77737", "#1a7a4a"],
              borderWidth: 0,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#72728a", font: { size: 11 }, padding: 12, boxWidth: 10 },
            },
          },
        }}
      />
    </div>
  );
}

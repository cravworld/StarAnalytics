"use client";

import "./register";
import { Doughnut } from "react-chartjs-2";
import { SERIES, LEAF, INK_SOFT, monoFamily } from "./theme";

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
              // Ramp REVERSED on purpose. Engagement is dominated by Likes, so the
              // darkest step would otherwise ink in ~85% of the ring and read as a
              // black blob, while the three slices a person actually needs to find
              // shrink to pale slivers. Light tone on the large area, dark tone on the
              // small ones: total ink stays balanced and the small slices stay legible.
              // Parts of a whole, so this takes the sequential ramp rather than
              // four unrelated hues. Because the ramp is monotonic in luminance,
              // legend order maps to segment order unambiguously and the segments
              // stay distinguishable in greyscale and under colour-blindness.
              backgroundColor: [...SERIES].reverse(),
              // Adjacent segments touch along an arc, so they get a hard paper gap
              // rather than a dark outline — an ink ring would merge into the two
              // darkest segments and muddy the centre.
              borderColor: LEAF,
              borderWidth: 2,
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
              labels: {
                color: INK_SOFT,
                font: { family: monoFamily(), size: 10 },
                padding: 12,
                boxWidth: 10,
              },
            },
          },
        }}
      />
    </div>
  );
}

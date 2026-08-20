"use client";

import "@/components/charts/register";
import { Line } from "react-chartjs-2";
import { demandRank, type DemandLevel } from "@/lib/bookmyshow/demand";
import { GRIDLINE, INK, INK_FILL, tickFont } from "@/components/charts/theme";
import { formatIstDateTime } from "@/lib/format";

export interface TrendPoint {
  capturedAt: string | Date;
  demandLevel: DemandLevel;
}

const LEVEL_TICKS: Record<number, string> = {
  3: "Wide open",
  2: "Filling",
  1: "Limited",
};

/**
 * Demand level over time for one show.
 *
 * Plotted on the ordinal rank scale, NOT on a percentage axis — there is no percentage to
 * plot. The y-axis is labelled with the level names for exactly that reason: a bare 1-3
 * axis invites a reader to treat it as a quantity, and the whole point is that it is not
 * one.
 *
 * Points where the level has no rank (`unavailable` / `unknown`) are plotted as gaps
 * rather than zeros. A gap reads as "no reading"; a zero would read as "nothing left",
 * which for a cancelled show would be exactly backwards.
 */
export function DemandTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Only one observation so far — a trend needs at least two scans.
      </div>
    );
  }

  const labels = points.map((p) =>
    formatIstDateTime(p.capturedAt),
  );

  return (
    <div className="chart-wrap-sm">
      <Line
        data={{
          labels,
          datasets: [
            {
              data: points.map((p) => demandRank(p.demandLevel)),
              borderColor: INK,
              backgroundColor: INK_FILL,
              fill: true,
              // Stepped, not smoothed: this is an ordinal state that changes at a moment,
              // and a curve between two levels implies intermediate values that do not
              // exist.
              stepped: true,
              pointRadius: 3,
              borderWidth: 2,
              spanGaps: false,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const point = points[ctx.dataIndex];
                  return LEVEL_TICKS[demandRank(point.demandLevel) ?? -1] ?? point.demandLevel;
                },
              },
            },
          },
          scales: {
            y: {
              min: 0.5,
              max: 3.5,
              ticks: {
                stepSize: 1,
                font: tickFont(),
                callback: (value) => LEVEL_TICKS[Number(value)] ?? "",
              },
              grid: { color: GRIDLINE },
            },
            x: { ticks: { font: tickFont(), maxTicksLimit: 8 }, grid: { display: false } },
          },
        }}
      />
    </div>
  );
}

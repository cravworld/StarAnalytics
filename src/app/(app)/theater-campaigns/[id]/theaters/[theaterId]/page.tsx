import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { DemandPill } from "@/components/theater/DemandPill";
import { DemandTrendChart } from "@/components/theater/DemandTrendChart";
import { getTheaterShows } from "@/lib/data/theaterCampaigns";
import type { DemandLevel } from "@/lib/bookmyshow/demand";
import { formatIstDateTime } from "@/lib/format";

function when(d: Date | string): string {
  return formatIstDateTime(d);
}

export default async function TheaterShowsPage({
  params,
}: {
  params: Promise<{ id: string; theaterId: string }>;
}) {
  const { id, theaterId } = await params;
  const shows = await getTheaterShows(id, theaterId);
  if (shows.length === 0) notFound();

  const theaterName = shows[0].theaterName;

  return (
    <>
      <Link className="back-link" href={`/theater-campaigns/${id}`}>
        ← Theater priority
      </Link>

      <h1 className="h2" style={{ margin: "0 0 2px" }}>
        {theaterName}
      </h1>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        {shows[0].cityName} · {shows.length} shows observed
      </div>

      {shows.map((show) => {
        const latest = show.history[show.history.length - 1];
        return (
          <Card key={show.id} title={`${when(show.showDateTime)}${show.format ? ` · ${show.format}` : ""}${show.language ? ` · ${show.language}` : ""}`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", fontSize: 12, marginBottom: 10 }}>
              {latest ? <DemandPill level={latest.demandLevel} /> : null}
              <span>
                <span style={{ color: "var(--muted)" }}>Observations </span>
                {show.history.length}
              </span>
              <span>
                <span style={{ color: "var(--muted)" }}>Last seen </span>
                {when(show.lastSeenAt)}
              </span>
              {show.priceBands.length > 0 ? (
                <span title="BookMyShow exposes which price bands a show offers, not the actual ticket prices.">
                  <span style={{ color: "var(--muted)" }}>Price bands </span>
                  {show.priceBands.join(", ")}
                </span>
              ) : null}
              {show.disappearedAt ? (
                <span style={{ color: "var(--pencil-red)" }}>
                  No longer listed as of {when(show.disappearedAt)} — could be a cancellation, a schedule
                  change, or simply delisted. BookMyShow does not say which.
                </span>
              ) : null}
            </div>

            <DemandTrendChart points={show.history.map((h) => ({ capturedAt: h.capturedAt, demandLevel: h.demandLevel }))} />

            {/* Developer / source panel — the raw values behind the label, so a reading can
                always be traced back to exactly what BookMyShow returned. */}
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                Source data ({show.bmsSessionId})
              </summary>
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {["Captured", "availStatus", "Level", "Source label", "Pill style", "Confidence"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "4px 8px",
                            borderBottom: "1px solid var(--border)",
                            color: "var(--muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {show.history.map((h) => (
                      <tr key={String(h.capturedAt)}>
                        <td style={cell}>{when(h.capturedAt)}</td>
                        <td style={cell}>{h.availStatus ?? "–"}</td>
                        <td style={cell}>{h.demandLevel as DemandLevel}</td>
                        <td style={cell}>{h.sourceLabel ?? "–"}</td>
                        <td style={cell}>{h.styleId ?? "–"}</td>
                        <td style={cell}>{h.confidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
        );
      })}
    </>
  );
}

const cell: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

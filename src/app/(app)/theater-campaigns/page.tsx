import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { listTheaterCampaigns } from "@/lib/data/theaterCampaigns";
import { isBookMyShowLive } from "@/lib/bookmyshow/providers";

export const metadata = { title: "Theater Campaigns" };

function when(d: Date | null | undefined): string {
  if (!d) return "never";
  return new Date(d).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TheaterCampaignsPage() {
  const campaigns = await listTheaterCampaigns();
  const live = isBookMyShowLive();

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h1 className="h2" style={{ margin: 0 }}>
            Theater Campaigns
          </h1>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Where a film still has seats on sale close to showtime, from BookMyShow&apos;s public listings.
            Estimated demand pressure — not ticket sales.
          </div>
        </div>
        <Link className="btn btn-primary" href="/theater-campaigns/new">
          New campaign
        </Link>
      </div>

      {!live ? (
        <div
          className="card"
          style={{ borderColor: "rgba(196,152,0,.4)", background: "rgba(241,177,3,.07)", marginBottom: 12 }}
        >
          <div className="card-title">Mock data mode</div>
          <div style={{ fontSize: 12 }}>
            <code>DATA_MODE_BOOKMYSHOW</code> is not set to <code>live</code>, so scans replay the bundled
            fixture rather than reading BookMyShow. The figures are real measurements taken on 2026-08-20, but
            they do not update. See <code>BOOKMYSHOW-FEASIBILITY.md</code> for what has to be verified before
            switching this on.
          </div>
        </div>
      ) : null}

      <Card title="Campaigns">
        {campaigns.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            No theater campaigns yet. Create one with the film&apos;s BookMyShow event code to start tracking
            where it still has seats on sale.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Campaign", "Movie", "Status", "Cities", "Shows tracked", "Last scan"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "6px 10px",
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
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                      <Link href={`/theater-campaigns/${c.id}`}>{c.name}</Link>
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>{c.movieName}</td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                      <Pill kind={c.status === "active" ? "live" : "default"}>{c.status}</Pill>
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>{c.cityCount}</td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                      {c.screeningCount}
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                      {when(c.lastScan?.finishedAt ?? c.lastScan?.startedAt)}
                      {c.lastScan && c.lastScan.status !== "done" ? (
                        <>
                          {" "}
                          <Pill kind={c.lastScan.status === "partial" ? "warn" : "bad"}>{c.lastScan.status}</Pill>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Kpi, KpiGrid } from "@/components/ui/Kpi";
import { ScanNowButton } from "@/components/theater/ScanNowButton";
import { ScanStatusPanel } from "@/components/theater/ScanStatusPanel";
import { TheaterPriorityTable } from "@/components/theater/TheaterPriorityTable";
import { getTheaterCampaignDetail } from "@/lib/data/theaterCampaigns";

export default async function TheaterCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getTheaterCampaignDetail(id);
  if (!detail) notFound();

  const { campaign, theaters, totals } = detail;
  const pushHere = theaters.filter((t) => t.priority.band === "high").length;
  const notRanked = theaters.filter((t) => t.priority.band === "not_ranked").length;
  const wideOpenPct = totals.shows > 0 ? Math.round((totals.byLevel.wide_open / totals.shows) * 100) : 0;

  return (
    <>
      <Link className="back-link" href="/theater-campaigns">
        ← Theater Campaigns
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 className="h2" style={{ margin: 0 }}>
            {campaign.name}
          </h1>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {campaign.movieName} · {campaign.bmsEventCode} ·{" "}
            {campaign.targetCityCodes.length === 0
              ? "all Kerala regions"
              : `${campaign.targetCityCodes.length} cities`}
          </div>
        </div>
        <ScanNowButton campaignId={campaign.id} />
      </div>

      <KpiGrid cols={4}>
        <Kpi
          label="Theaters tracked"
          value={String(totals.theaters)}
          note={notRanked > 0 ? `${notRanked} with too little data` : undefined}
        />
        <Kpi label="Shows observed" value={String(totals.shows)} />
        <Kpi
          label="Shows still wide open"
          value={`${wideOpenPct}%`}
          circled
          note="estimated — BookMyShow availability, not sales"
        />
        <Kpi label="Theaters to push" value={String(pushHere)} />
      </KpiGrid>

      <ScanStatusPanel detail={detail} />

      <Card title="Theater priority">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
          Ranked worst-first by how much of each theater&apos;s slate BookMyShow still reports as having seats
          on sale, how soon those shows screen, and whether that has moved since the first observation. These
          are <strong>estimated demand signals from public availability labels</strong> — BookMyShow publishes
          no seat counts, so this is not occupancy and not ticket sales.
        </div>
        <TheaterPriorityTable campaignId={campaign.id} rows={theaters} now={Date.now()} />
      </Card>
    </>
  );
}

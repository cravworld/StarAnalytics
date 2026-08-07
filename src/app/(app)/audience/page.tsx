import { getAudienceData } from "@/lib/data/audience";
import { isInstagramInsightsLive } from "@/lib/providers";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { PendingMetaReviewBanner } from "@/components/ui/PendingMetaReview";
import { AgeBar } from "@/components/charts/AgeBar";

const TIME_LABELS = ["6a", "9a", "12p", "3p", "6p", "9p"];

export default async function AudiencePage() {
  const demo = await getAudienceData();
  const maxLocationPct = Math.max(...demo.topLocations.map((l) => l.pct));

  return (
    <>
      {!isInstagramInsightsLive() && <PendingMetaReviewBanner />}
      <KpiGrid cols={3}>
        <Kpi label="Top City" value={demo.topCity} delta={`${demo.topCityPct}% of audience`} />
        <Kpi label="Dominant Age" value={demo.dominantAge} delta={`${demo.dominantAgePct}% of followers`} />
        <Kpi label="Gender Split" value={`${demo.genderSplit.male}M / ${demo.genderSplit.female}F`} delta="Male-leaning" />
      </KpiGrid>

      <div className="g2">
        <Card title="Top Locations">
          {demo.topLocations.map((loc) => (
            <div className="bar-row" key={loc.city}>
              <div className="bar-label">{loc.city}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(loc.pct / maxLocationPct) * 100}%` }} />
              </div>
              <div className="bar-val">{loc.pct}%</div>
            </div>
          ))}
        </Card>
        <Card title="Age Distribution">
          <AgeBar data={demo.ageDistribution} />
        </Card>
      </div>

      <Card title="Best Time to Post — Engagement Heatmap">
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 3, paddingLeft: 38, marginBottom: 4 }}>
            {TIME_LABELS.map((t) => (
              <span key={t} style={{ fontSize: 10, color: "var(--muted)", width: 20, textAlign: "center" }}>
                {t}
              </span>
            ))}
          </div>
          {Object.entries(demo.heatmap).map(([day, values]) => (
            <div key={day} style={{ display: "flex", gap: 3, marginBottom: 3, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--muted)", width: 34, textAlign: "right" }}>{day}</span>
              {values.map((v, i) => (
                <div className={`heat-cell h${v}`} key={i} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>Low</span>
          <div style={{ display: "flex", gap: 2 }}>
            {[0, 1, 2, 3, 4].map((v) => (
              <div className={`heat-cell h${v}`} key={v} />
            ))}
          </div>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>High</span>
        </div>
      </Card>
    </>
  );
}

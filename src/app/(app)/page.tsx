import { getDashboardData } from "@/lib/data/dashboard";
import { formatCompactNumber } from "@/lib/format";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { EngagementDoughnut } from "@/components/charts/EngagementDoughnut";

export default async function DashboardPage() {
  const { insights, topPosts } = await getDashboardData();

  return (
    <>
      <KpiGrid cols={4}>
        <Kpi
          label="Followers"
          value={formatCompactNumber(insights.followers)}
          delta={`↑ +${(insights.followersDeltaWeek / 1000).toFixed(1)}K this week`}
          deltaDirection="up"
        />
        <Kpi
          label="Engagement Rate"
          value={`${insights.engagementRate}%`}
          delta={`↑ +${insights.engagementRateDeltaMonth}% vs last month`}
          deltaDirection="up"
        />
        <Kpi
          label="Reach (30d)"
          value={formatCompactNumber(insights.reach30d)}
          delta={`↓ ${insights.reach30dDeltaPct}% vs prev period`}
          deltaDirection="dn"
        />
        <Kpi
          label="Profile Visits"
          value={formatCompactNumber(insights.profileVisits)}
          delta={`↑ +${insights.profileVisitsDeltaPct}% this week`}
          deltaDirection="up"
        />
      </KpiGrid>

      <div className="g2">
        <Card title="Follower Growth — 12 Weeks">
          <GrowthChart data={insights.followerGrowth12w} />
        </Card>
        <Card title="Engagement Breakdown">
          <EngagementDoughnut data={insights.engagementBreakdown} />
        </Card>
      </div>

      <div className="section-title">Top Posts This Month</div>
      <div className="post-grid">
        {topPosts.map((p, i) => (
          <div className="post-thumb" key={i}>
            <div className="post-thumb-icon">{p.icon}</div>
            <div className="post-overlay">
              <span className="post-stat">♥ {p.likes}</span>
              <span className="post-stat">💬 {p.comments}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

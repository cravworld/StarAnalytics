import { getContentData } from "@/lib/data/content";
import { formatCompactNumber } from "@/lib/format";
import { isInstagramInsightsLive } from "@/lib/providers";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { PendingMetaReviewBanner } from "@/components/ui/PendingMetaReview";
import { PostTypeBar } from "@/components/charts/PostTypeBar";
import { ReachLine } from "@/components/charts/ReachLine";

export default async function ContentPage() {
  const { insights, recentPosts } = await getContentData();

  return (
    <>
      {!isInstagramInsightsLive() && <PendingMetaReviewBanner />}
      <KpiGrid cols={4}>
        <Kpi label="Best Format" value={insights.bestFormat} delta={`${insights.bestFormatEngagement}% avg eng`} deltaDirection="up" />
        <Kpi label="Best Time" value={insights.bestPostTime} delta="Peak engagement" />
        <Kpi label="Posts This Month" value={String(insights.postsThisMonth)} delta={`↑ +${insights.postsThisMonthDelta} vs last`} deltaDirection="up" />
        <Kpi
          label="Avg Reel Views"
          value={formatCompactNumber(insights.avgReelViews)}
          delta={`↑ +${insights.avgReelViewsDeltaPct}%`}
          deltaDirection="up"
        />
      </KpiGrid>

      <div className="g2">
        <Card title="Post Type Performance">
          <PostTypeBar data={insights.postTypePerformance} />
        </Card>
        <Card title="Reach by Week">
          <ReachLine data={insights.reachByWeek} />
        </Card>
      </div>

      <div className="section-title">Recent Posts</div>
      <div className="post-grid">
        {recentPosts.map((p, i) => (
          <div className="post-thumb" key={i}>
            <div className="post-thumb-icon">{p.icon}</div>
            <div className="post-overlay">
              <span className="post-stat">{p.stat}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

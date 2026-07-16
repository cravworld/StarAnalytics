import type { CampaignSentiment } from "@/lib/data/campaigns";

// Renders a partial (not "complete-looking but actually partial") aggregate — see
// AGENTS.md Phase 4 §B4. sentiment is null only when zero posts are classified yet.
export function SentimentBar({ sentiment }: { sentiment: CampaignSentiment | null }) {
  if (!sentiment) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
        Sentiment analysis pending — no posts classified yet.
      </div>
    );
  }

  const { positivePct, neutralPct, negativePct, classifiedCount, totalCount } = sentiment;

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--faint)" }}>
        <div style={{ width: `${positivePct}%`, background: "#1a7a4a" }} />
        <div style={{ width: `${neutralPct}%`, background: "#bdbdbd" }} />
        <div style={{ width: `${negativePct}%`, background: "#c62828" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
        <span style={{ color: "#1a7a4a" }}>{positivePct}% positive</span>
        <span style={{ color: "var(--muted)" }}>{neutralPct}% neutral</span>
        <span style={{ color: "#c62828" }}>{negativePct}% negative</span>
      </div>
      {classifiedCount < totalCount && (
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>
          {classifiedCount} of {totalCount} posts classified
        </div>
      )}
    </div>
  );
}

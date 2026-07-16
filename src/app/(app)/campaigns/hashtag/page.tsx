import { getTrackedHashtags } from "@/lib/data/campaigns";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TrackHashtagForm } from "@/components/campaigns/TrackHashtagForm";

const TAG_KIND: Record<string, "new" | "hot" | "live" | "default"> = {
  New: "new",
  Trending: "hot",
  Campaign: "live",
};

export default async function HashtagSearchPage() {
  const hashtags = await getTrackedHashtags();

  return (
    <>
      <TrackHashtagForm />
      <Card title="Tracked Hashtags">
        {hashtags.length === 0 ? (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
            No hashtags tracked yet — track one above to start polling it.
          </div>
        ) : (
          hashtags.map((h) => (
            <div className="htag-row" key={h.name}>
              <div className="htag-name">{h.name}</div>
              <div className="htag-track">
                <div className="htag-fill" style={{ width: `${h.fillPct}%` }} />
              </div>
              <div className="htag-posts">{h.posts}</div>
              <div className="htag-eng">{h.eng}</div>
              <Pill kind={TAG_KIND[h.tag] ?? "default"}>{h.tag}</Pill>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

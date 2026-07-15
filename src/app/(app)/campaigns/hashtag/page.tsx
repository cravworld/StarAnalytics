import { getTrackedHashtags } from "@/lib/data/campaigns";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";

const TAG_KIND: Record<string, "new" | "hot" | "default"> = {
  New: "new",
  Trending: "hot",
};

export default async function HashtagSearchPage() {
  const hashtags = await getTrackedHashtags();

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input placeholder="Search any hashtag or keyword…" style={{ flex: 1 }} />
        <button className="btn btn-primary">Track Hashtag</button>
      </div>
      <Card title="Tracked Hashtags">
        {hashtags.map((h) => (
          <div className="htag-row" key={h.name}>
            <div className="htag-name">{h.name}</div>
            <div className="htag-track">
              <div className="htag-fill" style={{ width: `${h.fillPct}%` }} />
            </div>
            <div className="htag-posts">{h.posts}</div>
            <div className="htag-eng">{h.eng}</div>
            <Pill kind={TAG_KIND[h.tag] ?? "default"}>{h.tag}</Pill>
          </div>
        ))}
      </Card>
    </>
  );
}

import Link from "next/link";
import { getTrackedCampaigns } from "@/lib/data/trackedPosts";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";

export default async function TrackerIndexPage() {
  const campaigns = await getTrackedCampaigns();
  const tracked = campaigns.filter((c) => c.trackedPosts > 0);
  const untracked = campaigns.filter((c) => c.trackedPosts === 0);

  return (
    <>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, lineHeight: 1.55, maxWidth: 620 }}>
        Track the posts your influencers published for a campaign. Paste a post link and the
        account that posted it is detected automatically, so posts group by page and can be
        compared against each other — and against that account&apos;s own normal engagement.
      </div>

      {tracked.length > 0 ? (
        <>
          <div className="section-title">Tracking</div>
          <div className="g3">
            {tracked.map((c) => (
              <Link key={c.id} href={`/campaigns/tracker/${c.id}`} style={{ textDecoration: "none" }}>
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{c.name}</strong>
                    <Pill kind={c.status === "live" ? "live" : "planned"}>{c.status}</Pill>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
                    {c.trackedPosts} post{c.trackedPosts === 1 ? "" : "s"} tracked
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-title">Start tracking</div>
      {untracked.length === 0 ? (
        <Card>
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
            {campaigns.length === 0
              ? "No campaigns yet — create one first."
              : "Every campaign already has tracked posts."}
          </div>
        </Card>
      ) : (
        <div className="g3">
          {untracked.map((c) => (
            <Link key={c.id} href={`/campaigns/tracker/${c.id}`} style={{ textDecoration: "none" }}>
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{c.name}</strong>
                  <Pill kind={c.status === "live" ? "live" : "planned"}>{c.status}</Pill>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>No posts tracked yet</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

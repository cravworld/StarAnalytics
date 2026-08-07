// Renders nothing while ingest is healthy, so it can sit in AppShell unconditionally.
//
// Placed app-wide rather than on the campaign screens alone: a dead ingest pipeline is
// a fact about the whole product, and AppShell is the only server component in the
// layout chain that can query for it — campaigns/layout.tsx is a client component.
//
// On Dashboard/Content/Audience this can stack under PendingMetaReviewBanner. That is
// correct, not a collision: those screens are mock because Meta App Review has not
// completed, and separately the real-data pipeline behind every other screen is down.
import { getPipelineHealth } from "@/lib/data/pipelineHealth";
import { formatAge } from "@/lib/format";

const TONE = {
  stale: { bg: "#fff3cd", border: "#ffe69c", text: "#8a6100", icon: "⏳" },
  down: { bg: "#fdecec", border: "#f0b4b4", text: "#b3261e", icon: "⚠" },
} as const;

export async function PipelineHealthBanner() {
  const health = await getPipelineHealth();
  if (health.status === "ok") return null;

  const tone = TONE[health.status];
  const scrapeAge = health.lastSuccessAt ? formatAge(health.lastSuccessAt) : null;
  // The two ages answer different questions and can legitimately disagree — a scrape
  // that succeeded but returned nothing new advances one and not the other. postAge is
  // the one that describes what is actually on screen, so it carries that clause.
  const postAge = health.newestPostAt ? formatAge(health.newestPostAt) : null;

  const headline = health.quotaExhausted
    ? "Data collection has stopped — the Apify monthly usage limit has been reached."
    : health.status === "down"
      ? "Data collection has stopped."
      : "Data collection may be behind.";

  const detail = scrapeAge
    ? `Last successful scrape ${scrapeAge}.${postAge ? ` Post, hashtag and sentiment figures on screen are from ${postAge}, not live.` : ""}`
    : "No successful scrape has been recorded yet.";

  const action = health.quotaExhausted
    ? " Raise the monthly usage limit in the Apify console to resume; collection restarts on its own within the hour."
    : "";

  return (
    <div
      // role=status rather than alert: this is a standing condition a reader should be
      // told about on arrival, not an interruption worth pre-empting whatever they were
      // already hearing.
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.text,
        borderRadius: "var(--radius-md, 8px)",
        padding: "10px 14px",
        fontSize: 12,
        lineHeight: 1.5,
        marginBottom: "var(--s4, 16px)",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: "18px" }} aria-hidden>
        {tone.icon}
      </span>
      <span>
        <strong style={{ fontWeight: 700 }}>{headline}</strong>{" "}
        {detail}
        {action}
        {health.failuresLast24h > 0 ? (
          <span style={{ opacity: 0.85 }}> {health.failuresLast24h} failed scrape attempts in the last 24 hours.</span>
        ) : null}
      </span>
    </div>
  );
}

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

// Tokens, not literals: a component carrying its own hexes survives a re-skin
// untouched and leaves the previous design showing through.
const TONE = {
  stale: { bg: "rgba(138,90,11,.10)", border: "rgba(138,90,11,.28)", text: "var(--pencil-amber)", icon: "⏳" },
  down: { bg: "rgba(129,0,31,.07)", border: "rgba(129,0,31,.26)", text: "var(--pencil-red)", icon: "⚠" },
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

  // Each block reason gets the cause it actually has and the fix that actually clears
  // it. Naming the wrong one is worse than naming none: on 2026-08-22 this told a reader
  // to raise a usage limit sitting at 30% while Apify was refusing over unpaid invoices,
  // which is an instruction that cannot work and hides the one that would.
  const BLOCKED = {
    "usage-cap": {
      cause: " — the Apify monthly usage limit has been reached.",
      action: " Raise the monthly usage limit in the Apify console to resume;",
    },
    billing: {
      cause: " — Apify has blocked this account over unpaid invoices.",
      action: " Settle the outstanding invoice under Billing in the Apify console to resume;",
    },
    unknown: {
      cause: health.blockMessage
        ? ` — Apify is refusing to start runs: "${health.blockMessage}".`
        : " — Apify is refusing to start runs.",
      action: " Check the account status in the Apify console to resume;",
    },
  } as const;

  const blocked = health.quotaExhausted ? BLOCKED[health.blockReason ?? "unknown"] : null;

  const headline = blocked
    ? `Data collection has stopped${blocked.cause}`
    : health.status === "down"
      ? "Data collection has stopped."
      : "Data collection may be behind.";

  const detail = scrapeAge
    ? `Last successful scrape ${scrapeAge}.${postAge ? ` Post, hashtag and sentiment figures on screen are from ${postAge}, not live.` : ""}`
    : "No successful scrape has been recorded yet.";

  // The recovery half is identical whatever the cause — the breaker re-probes on a
  // cooldown and closes on the first success — so it is stated once here rather than
  // repeated into all three.
  const action = blocked ? `${blocked.action} collection restarts on its own within the hour.` : "";

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
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        fontSize: 12,
        lineHeight: 1.5,
        marginBottom: "var(--s4)",
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

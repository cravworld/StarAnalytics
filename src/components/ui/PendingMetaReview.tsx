// Shown on every screen backed by InstagramInsightsProvider's self-account data
// (Dashboard/Content/Audience/Compare's self column) while it's still mock — Phase 7 (Meta App
// Review + Business/Creator account conversion) has never been completed. Both read
// isInstagramInsightsLive() so this disappears on its own once that pipeline actually goes
// live, no manual cleanup needed here.
//
// Colours come from the design tokens rather than the literal hexes this file used to
// carry. A component that hardcodes its own palette silently survives a re-skin and
// leaves the old design showing through — which is exactly what happened here before.
const COLORS = {
  bg: "rgba(138,90,11,.10)",
  border: "rgba(138,90,11,.28)",
  text: "var(--pencil-amber)",
};

export function PendingMetaReviewBanner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
        color: COLORS.text,
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        fontSize: 12,
        fontWeight: 600,
        marginBottom: "var(--s4)",
      }}
    >
      <span style={{ fontSize: 14 }} aria-hidden>
        ⏳
      </span>
      Pending Meta App Review — this screen shows sample data until Instagram Graph API access is approved for this account.
    </div>
  );
}

export function PendingMetaReviewBadge() {
  return (
    <span
      title="This column shows sample data until Instagram Graph API access is approved for this account (Meta App Review)."
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
        color: COLORS.text,
        borderRadius: "var(--radius-xs)",
        padding: "2px 8px",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: ".06em",
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>⏳</span> PENDING META REVIEW
    </span>
  );
}

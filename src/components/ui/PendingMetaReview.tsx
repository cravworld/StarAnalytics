// Shown on every screen backed by InstagramInsightsProvider's self-account data
// (Dashboard/Content/Audience/Compare's self column) while it's still mock — Phase 7 (Meta App
// Review + Business/Creator account conversion) has never been completed. Both read
// isInstagramInsightsLive() so this disappears on its own once that pipeline actually goes
// live, no manual cleanup needed here.
const COLORS = { bg: "#fff3cd", border: "#ffe69c", text: "#8a6100" };

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
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 16,
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
        borderRadius: 12,
        padding: "2px 8px",
        fontSize: 9,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>⏳</span> PENDING META REVIEW
    </span>
  );
}

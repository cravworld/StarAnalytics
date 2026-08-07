/**
 * Route-level loading and error states.
 *
 * `ScreenLoading` used to render a single line of centred text. Because the app
 * shell is a flex column, that collapsed the content area from full height to
 * ~40px on every navigation and snapped it back when the route resolved — the
 * single largest source of the "stuck / jumpy" feeling in the app. The skeletons
 * below hold the shape of the route being loaded so the layout never moves.
 */

function SkelLine({ width, height = 9 }: { width: string; height?: number }) {
  return <div className="skel skel-line" style={{ width, height }} />;
}

/** Matches .kpi exactly — same padding, same three stacked rows. */
function SkelKpi() {
  return (
    <div className="kpi">
      <SkelLine width="52%" height={8} />
      <div style={{ height: 6 }} />
      <SkelLine width="68%" height={20} />
      <div style={{ height: 6 }} />
      <SkelLine width="44%" height={8} />
    </div>
  );
}

function SkelCard({ height = 180 }: { height?: number }) {
  return (
    <div className="card">
      <SkelLine width="34%" height={8} />
      <div className="skel" style={{ height, borderRadius: "var(--radius-sm)", marginTop: "var(--s3)" }} />
    </div>
  );
}

/**
 * `cols` mirrors KpiGrid's own prop so a route's loading state can be given the
 * same shape as the route itself. Defaults to the 4-up grid, which is what the
 * majority of screens use.
 */
export function ScreenLoading({
  cols = 4,
  label = "Loading…",
}: {
  cols?: 3 | 4 | 5;
  label?: string;
}) {
  return (
    // aria-busy + a visually-hidden live region: the skeleton is decorative, so
    // screen readers get the word "Loading" rather than a description of grey boxes.
    <div aria-busy="true" aria-live="polite">
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <div className={`kpi-grid kpi-grid-${cols}`} aria-hidden="true">
        {Array.from({ length: cols }, (_, i) => (
          <SkelKpi key={i} />
        ))}
      </div>
      <div className="g2" aria-hidden="true">
        <SkelCard />
        <SkelCard />
      </div>
    </div>
  );
}

export function ScreenError({
  message = "Something went wrong loading this screen.",
}: {
  message?: string;
}) {
  return (
    <div className="card" role="alert" style={{ borderColor: "#f0b4b4", background: "#fdecec" }}>
      <div className="card-title" style={{ color: "var(--red)" }}>
        Error
      </div>
      <div style={{ fontSize: 12, color: "var(--text)" }}>{message}</div>
    </div>
  );
}

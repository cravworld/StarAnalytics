export function KpiGrid({ cols, children }: { cols: 3 | 4 | 5; children: React.ReactNode }) {
  return <div className={`kpi-grid kpi-grid-${cols}`}>{children}</div>;
}

/**
 * The hand-drawn ring that marks the one metric that matters most on a screen.
 *
 * Deliberately not a border-radius: a geometrically perfect ellipse reads as UI
 * chrome, and a slightly wobbly one reads as a pen. `pathLength="1"` normalises
 * the path so the draw-on animation in globals.css needs no measured length.
 * Purely decorative, so it is hidden from assistive tech — the value it circles
 * is already in the accessibility tree.
 */
function HandCircle() {
  return (
    <svg viewBox="0 0 120 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        pathLength="1"
        d="M12,32 C12,16 40,7 62,8 C88,9 110,17 110,32 C110,47 84,57 58,56 C30,55 8,46 9,31 C10,19 30,10 52,8"
      />
    </svg>
  );
}

export function Kpi({
  label,
  value,
  delta,
  deltaDirection,
  valueColor,
  compact,
  circled,
  note,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "dn";
  valueColor?: string;
  /**
   * Renders the value at 15px instead of the default 27px, for tiles whose value is
   * a name rather than a number — a long agency name otherwise overruns the card.
   */
  compact?: boolean;
  /**
   * Marks this tile as the screen's headline metric with a hand-drawn ring.
   * At most ONE per screen: the ring means "this is the primary read", and a
   * second one on the same screen destroys that meaning.
   */
  circled?: boolean;
  /**
   * A pen mark in the margin.
   *
   * HONESTY RULE — this is load-bearing, not style guidance. `note` may only ever
   * carry (a) a restatement of a value already computed and rendered on screen, or
   * (b) a static label describing the layout. It may NEVER carry a derived insight:
   * a handwritten "best week since March" would be an invented analytical claim,
   * which is worse than a missing number because it reads as human judgement.
   * Rendered aria-hidden, because in both permitted cases it duplicates or
   * describes content already in the accessibility tree. If you ever need an
   * annotation that is the sole carrier of a fact, it cannot use this prop —
   * it has to be real text, in the data voice, exposed to screen readers.
   */
  note?: string;
}) {
  const valueEl = (
    <div
      className="kpi-val"
      style={{
        ...(valueColor ? { color: valueColor } : {}),
        ...(compact ? { fontSize: 15 } : {}),
      }}
    >
      {value}
    </div>
  );

  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      {circled ? (
        <div className="circled">
          {valueEl}
          <HandCircle />
        </div>
      ) : (
        valueEl
      )}
      {delta ? (
        <div className={`kpi-delta${deltaDirection ? ` ${deltaDirection}` : ""}`}>{delta}</div>
      ) : null}
      {note ? (
        <div className="marginalia" aria-hidden="true">
          <span className="hand">{note}</span>
        </div>
      ) : null}
    </div>
  );
}

export function KpiGrid({ cols, children }: { cols: 3 | 4 | 5; children: React.ReactNode }) {
  return <div className={`kpi-grid kpi-grid-${cols}`}>{children}</div>;
}

export function Kpi({
  label,
  value,
  delta,
  deltaDirection,
  valueColor,
  compact,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "dn";
  valueColor?: string;
  /**
   * Renders the value at 15px instead of the default 24px, for tiles whose value is
   * a name rather than a number. Mirrors the prototype, which overrides
   * `.kpi-val` to font-size:15px on the Top Agency tile so a long agency name
   * doesn't overrun the card.
   */
  compact?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div
        className="kpi-val"
        style={{
          ...(valueColor ? { color: valueColor } : {}),
          ...(compact ? { fontSize: 15 } : {}),
        }}
      >
        {value}
      </div>
      {delta ? (
        <div className={`kpi-delta${deltaDirection ? ` ${deltaDirection}` : ""}`}>{delta}</div>
      ) : null}
    </div>
  );
}

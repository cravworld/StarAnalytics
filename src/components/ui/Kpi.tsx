export function KpiGrid({ cols, children }: { cols: 3 | 4 | 5; children: React.ReactNode }) {
  return <div className={`kpi-grid kpi-grid-${cols}`}>{children}</div>;
}

export function Kpi({
  label,
  value,
  delta,
  deltaDirection,
  valueColor,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "dn";
  valueColor?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-val" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {delta ? (
        <div className={`kpi-delta${deltaDirection ? ` ${deltaDirection}` : ""}`}>{delta}</div>
      ) : null}
    </div>
  );
}

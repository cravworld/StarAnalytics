// Shared mini bar-sparkline — reuses the same .spark-wrap/.sbar CSS as the campaign-detail
// hourly-volume chart, just sized down. No "use client": purely presentational, no hooks.
export function Sparkline({ values, width = 90, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  return (
    <div className="spark-wrap" style={{ height, width, gap: 1 }}>
      {values.map((v, i) => (
        <div key={i} className="sbar" style={{ height: `${(v / max) * 100}%`, opacity: v > 0 ? 1 : 0.15 }} />
      ))}
    </div>
  );
}

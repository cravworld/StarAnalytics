type PillKind = "live" | "planned" | "hot" | "new" | "fan" | "good" | "warn" | "bad" | "default";

export function Pill({ kind = "default", children }: { kind?: PillKind; children: React.ReactNode }) {
  const cls = kind === "default" ? "pill" : `pill pill-${kind}`;
  return <span className={cls}>{children}</span>;
}

export function LiveDot() {
  return <span className="live-dot" />;
}

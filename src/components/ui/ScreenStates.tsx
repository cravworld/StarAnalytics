export function ScreenLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
      {label}
    </div>
  );
}

export function ScreenError({ message = "Something went wrong loading this screen." }: { message?: string }) {
  return (
    <div className="card" style={{ borderColor: "#ef9a9a", background: "#ffebee" }}>
      <div className="card-title" style={{ color: "var(--red)" }}>
        Error
      </div>
      <div style={{ fontSize: 12, color: "var(--text)" }}>{message}</div>
    </div>
  );
}

export function ScreenEmpty({ message }: { message: string }) {
  return (
    <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
      {message}
    </div>
  );
}

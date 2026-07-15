export function Card({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {title ? <div className="card-title">{title}</div> : null}
      {children}
    </div>
  );
}

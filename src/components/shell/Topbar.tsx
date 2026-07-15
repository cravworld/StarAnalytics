"use client";

import { usePathname } from "next/navigation";

const BREADCRUMBS: Record<string, string[]> = {
  "/": ["Dashboard"],
  "/content": ["Content"],
  "/audience": ["Audience"],
  "/compare": ["Compare Pages"],
  "/campaigns": ["Campaigns", "Own Campaigns"],
  "/campaigns/hashtag": ["Campaigns", "Hashtag Search"],
  "/campaigns/agency": ["Campaigns", "Agency Report"],
  "/campaigns/vijayam": ["Campaigns", "Own Campaigns", "#vijayam"],
  "/fan-pages": ["Fan Pages"],
};

export function Topbar() {
  const pathname = usePathname();
  const crumbs = BREADCRUMBS[pathname] ?? [pathname];

  return (
    <div className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c}>
            {i > 0 ? " › " : ""}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : c}
          </span>
        ))}
      </div>
      <div className="topbar-actions">
        <button className="tb-btn">Last 30 days ▾</button>
        <button className="tb-btn primary">Export</button>
      </div>
    </div>
  );
}

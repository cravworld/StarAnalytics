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
  "/campaigns/new": ["Campaigns", "Own Campaigns", "New Campaign"],
  "/fan-pages": ["Fan Pages"],
};

const KNOWN_CAMPAIGN_SUBROUTES = ["/campaigns/hashtag", "/campaigns/agency", "/campaigns/new"];

export function Topbar() {
  const pathname = usePathname();
  // Campaign detail routes are /campaigns/[id] — id is a DB-generated uuid, not a
  // fixed slug, so it can't live in the static BREADCRUMBS map above.
  const isCampaignDetail =
    pathname !== "/campaigns" &&
    pathname.startsWith("/campaigns/") &&
    !KNOWN_CAMPAIGN_SUBROUTES.some((r) => pathname.startsWith(r));
  const crumbs = isCampaignDetail
    ? ["Campaigns", "Own Campaigns", "Campaign Detail"]
    : (BREADCRUMBS[pathname] ?? [pathname]);

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

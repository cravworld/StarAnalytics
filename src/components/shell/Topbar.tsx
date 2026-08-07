"use client";

import { usePathname } from "next/navigation";
import { downloadCsv } from "@/lib/csv";
import { useTopbarExportConfig } from "./TopbarExportContext";

const BREADCRUMBS: Record<string, string[]> = {
  "/": ["Dashboard"],
  "/content": ["Content"],
  "/audience": ["Audience"],
  "/compare": ["Compare Pages"],
  "/campaigns": ["Campaigns", "Own Campaigns"],
  "/campaigns/hashtag": ["Campaigns", "Hashtag Search"],
  "/campaigns/keywords": ["Campaigns", "Keyword Trends"],
  "/campaigns/compare-own": ["Campaigns", "Compare Campaigns"],
  "/campaigns/agency": ["Campaigns", "Agency Report"],
  "/campaigns/new": ["Campaigns", "Own Campaigns", "New Campaign"],
  "/fan-pages": ["Fan Pages"],
};

const KNOWN_CAMPAIGN_SUBROUTES = ["/campaigns/hashtag", "/campaigns/keywords", "/campaigns/compare-own", "/campaigns/agency", "/campaigns/new"];

export function Topbar() {
  const pathname = usePathname();
  const { config } = useTopbarExportConfig();
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
    <header className="topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c}>
            {i > 0 ? " › " : ""}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : c}
          </span>
        ))}
      </nav>
      <div className="topbar-actions">
        {/* Dashboard/Content/Audience run on mock InstagramInsights until Phase 7 (real
            Graph API, since/until-based) — a date range here would either do nothing or
            fabricate per-range numbers. Disabled rather than faked; re-enable once Phase 7
            wires a real date dimension into at least one screen. */}
        <button className="tb-btn" disabled title="Date range filtering lands with Phase 7 (Instagram Graph API) — no honest range-backed data exists yet">
          Last 30 days ▾
        </button>
        <button
          className="tb-btn primary"
          disabled={!config}
          title={config ? `Export ${config.filename}` : "No exportable data on this screen"}
          onClick={() => config && downloadCsv(config.filename, config.csv())}
        >
          Export
        </button>
      </div>
    </header>
  );
}

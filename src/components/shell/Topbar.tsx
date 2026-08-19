"use client";

import { usePathname } from "next/navigation";
import { downloadCsv } from "@/lib/csv";
import { CAMPAIGN_SUBROUTES, isCampaignDetailRoute } from "@/lib/campaignRoutes";
import { useTopbarExportConfig } from "./TopbarExportContext";

// Campaign subroute crumbs are derived from the shared route list rather than restated
// here, so adding a page can't leave this map behind (it did, for /campaigns/keywords).
// /campaigns/new keeps an explicit three-level entry — it sits under Own Campaigns, not
// beside it — and overrides the derived one.
const BREADCRUMBS: Record<string, string[]> = {
  "/": ["Dashboard"],
  "/content": ["Content"],
  "/audience": ["Audience"],
  "/compare": ["Compare Pages"],
  "/campaigns": ["Campaigns", "Own Campaigns"],
  ...Object.fromEntries(CAMPAIGN_SUBROUTES.map((r) => [r.href, ["Campaigns", r.label]])),
  "/campaigns/new": ["Campaigns", "Own Campaigns", "New Campaign"],
  "/fan-pages": ["Fan Pages"],
  "/scout": ["Scoutline"],
  "/scout/compare": ["Scoutline", "Compare Batches"],
};

// KNOWN_CAMPAIGN_SUBROUTES used to sit beside this one. It is gone deliberately: the
// campaign list now lives in lib/campaignRoutes.ts as the single source of truth, and
// the copy that used to be here had already fallen behind — it was missing
// /campaigns/comments, which would have misclassified that page as a campaign *detail*
// view and rendered "Campaigns › Own Campaigns › Campaign Detail" on it. That drift is
// exactly what campaignRoutes.ts was written to stop.
//
// Scout has no equivalent shared list yet, so its one subroute stays inlined here.
const KNOWN_SCOUT_SUBROUTES = ["/scout/compare"];

export function Topbar() {
  const pathname = usePathname();
  const { config } = useTopbarExportConfig();
  // Campaign detail routes are /campaigns/[id] — id is a DB-generated uuid, not a
  // fixed slug, so it can't live in the static BREADCRUMBS map above.
  const isCampaignDetail = isCampaignDetailRoute(pathname);
  // /scout/[batchId] — same "detail route with a DB-generated id" shape as campaign detail.
  const isScoutBatchDetail =
    pathname !== "/scout" &&
    pathname.startsWith("/scout/") &&
    !KNOWN_SCOUT_SUBROUTES.some((r) => pathname.startsWith(r));
  // /campaigns/[id]/media-kit sits under the detail route, so it matched the branch
  // below and announced itself as "Campaign Detail" — the one screen in the app whose
  // breadcrumb named a different page than the one being looked at.
  const isMediaKit = isCampaignDetail && pathname.endsWith("/media-kit");
  const crumbs = isMediaKit
    ? ["Campaigns", "Own Campaigns", "Campaign Detail", "Media Kit"]
    : isCampaignDetail
    ? ["Campaigns", "Own Campaigns", "Campaign Detail"]
    : isScoutBatchDetail
      ? ["Scoutline", "Batch"]
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

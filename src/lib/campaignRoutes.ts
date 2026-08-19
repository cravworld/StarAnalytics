// Single source of truth for the /campaigns/* subroutes.
//
// This list previously lived in three places — Sidebar's CAMPAIGN_SUBS, Topbar's
// BREADCRUMBS + KNOWN_CAMPAIGN_SUBROUTES, and campaigns/layout.tsx's knownSubRoutes — and
// drifted twice. Each consumer decides "is this pathname a campaign *detail* view
// (/campaigns/[id]) or a known sibling page?", and a page missing from any one copy is
// silently misclassified as a detail route: Topbar renders "Campaigns › Own Campaigns ›
// Campaign Detail" and the layout lights up (and sets aria-current="page" on) the wrong
// tab. Both symptoms shipped for /campaigns/keywords and /campaigns/compare-own.
//
// A campaign id is a DB-generated uuid, so it can never be enumerated here — the detail
// check is necessarily "not one of these", which is exactly why the list has to be complete.

export interface CampaignSubroute {
  href: string;
  label: string;
  badge?: string;
  /** Reachable, but not offered as a nav destination — it's a create form, not a view. */
  hiddenFromNav?: boolean;
}

export const CAMPAIGN_SUBROUTES: CampaignSubroute[] = [
  { href: "/campaigns/hashtag", label: "Hashtag Search" },
  { href: "/campaigns/keywords", label: "Keyword Trends" },
  { href: "/campaigns/comments", label: "Comment Sentiment" },
  { href: "/campaigns/compare-own", label: "Compare Campaigns" },
  { href: "/campaigns/agency", label: "Agency Report", badge: "New" },
  { href: "/campaigns/new", label: "New Campaign", hiddenFromNav: true },
];

export const CAMPAIGN_NAV_SUBROUTES = CAMPAIGN_SUBROUTES.filter((r) => !r.hiddenFromNav);

/**
 * True for /campaigns/[id] — a campaign detail view — and false for /campaigns itself and
 * every known sibling page above.
 *
 * `startsWith` rather than equality so a nested route under a known subroute (e.g. a future
 * /campaigns/agency/[runId]) stays classified with its parent instead of falling through.
 */
export function isCampaignDetailRoute(pathname: string): boolean {
  return (
    pathname !== "/campaigns" &&
    pathname.startsWith("/campaigns/") &&
    !CAMPAIGN_SUBROUTES.some((r) => pathname.startsWith(r.href))
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  content: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21,15 16,10 5,21" />
    </svg>
  ),
  audience: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  compare: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="17,1 21,5 17,9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7,23 3,19 7,15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  campaigns: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22l-4-9-9-4z" />
    </svg>
  ),
  fanpages: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  ),
  scout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
};

const MY_PAGE = [
  { href: "/", key: "dashboard", label: "Dashboard" },
  { href: "/content", key: "content", label: "Content" },
  { href: "/audience", key: "audience", label: "Audience" },
  { href: "/compare", key: "compare", label: "Compare Pages" },
];

const CAMPAIGN_SUBS = [
  { href: "/campaigns", label: "Own Campaigns" },
  { href: "/campaigns/hashtag", label: "Hashtag Search" },
  { href: "/campaigns/keywords", label: "Keyword Trends" },
  { href: "/campaigns/compare-own", label: "Compare Campaigns" },
  { href: "/campaigns/agency", label: "Agency Report", badge: "New" },
];

export function Sidebar({ fanPageCount }: { fanPageCount: number }) {
  const pathname = usePathname();
  const inCampaigns = pathname.startsWith("/campaigns");

  return (
    <nav className="sidebar" aria-label="Primary">
      {/* Keyboard users otherwise tab through 11 nav links to reach the page they
          just navigated to. Visually hidden until focused. */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="logo-wrap">
        <div className="logo-name">StarAnalytics</div>
        <div className="logo-sub">Nivin Pauly · Actor</div>
      </div>

      <div className="nav-sec">My Page</div>
      {MY_PAGE.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          // aria-current is what tells a screen reader which page it is on. The
          // `.active` class alone conveys that to sighted users only.
          aria-current={pathname === item.href ? "page" : undefined}
          className={`nav-item${pathname === item.href ? " active" : ""}`}
        >
          {NAV_ICONS[item.key]}
          {item.label}
        </Link>
      ))}

      <div className="nav-sec">Campaigns</div>
      <Link
        href="/campaigns"
        aria-current={inCampaigns ? "page" : undefined}
        className={`nav-item${inCampaigns ? " active" : ""}`}
      >
        {NAV_ICONS.campaigns}
        Campaigns
      </Link>
      {/* Grouping wrapper only. Below 900px the sidebar becomes a horizontal rail
          and this div is flattened with `display:contents` so the sub-items join
          that row instead of stacking into a column inside it. */}
      <div className="nav-sub-group">
        {CAMPAIGN_SUBS.map((sub) => (
          <Link
            key={sub.href}
            href={sub.href}
            aria-current={pathname === sub.href ? "page" : undefined}
            className={`nav-sub${pathname === sub.href ? " active" : ""}`}
          >
            <div className="nav-sub-dot" aria-hidden="true" />
            {sub.label}
            {sub.badge ? <span className="nav-badge" style={{ marginLeft: "auto" }}>{sub.badge}</span> : null}
          </Link>
        ))}
      </div>

      <div className="nav-sec">Talent</div>
      <Link
        href="/scout"
        aria-current={pathname.startsWith("/scout") ? "page" : undefined}
        className={`nav-item${pathname.startsWith("/scout") ? " active" : ""}`}
      >
        {NAV_ICONS.scout}
        Scoutline
      </Link>

      <div className="nav-sec">Community</div>
      <Link
        href="/fan-pages"
        aria-current={pathname === "/fan-pages" ? "page" : undefined}
        className={`nav-item${pathname === "/fan-pages" ? " active" : ""}`}
      >
        {NAV_ICONS.fanpages}
        Fan Pages
        {fanPageCount > 0 ? (
          // Bare "24" next to "Fan Pages" reads as "Fan Pages 24" to a screen
          // reader, which sounds like a page number.
          <span className="nav-badge" aria-label={`${fanPageCount} tracked fan pages`}>
            {fanPageCount}
          </span>
        ) : null}
      </Link>

      <div className="sidebar-footer">
        <div className="avatar">NP</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Nivin Pauly</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>@nivinpauly</div>
        </div>
      </div>
    </nav>
  );
}

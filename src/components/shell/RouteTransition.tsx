"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Re-keys the content area on every route change so the `.route-fade` keyframe
 * replays. Without a changing key React reuses the same DOM node and the
 * animation only ever runs once, on first paint.
 *
 * `children` are server-rendered elements passed through as props — this client
 * boundary wraps them, it does not pull any page code into the client bundle.
 *
 * The motion is deliberately tiny (2px, 280ms, opacity+transform only). Anything
 * larger competes with the loading skeleton that renders inside this same
 * container and starts to read as latency rather than polish.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    // <main> rather than <div>: this is the app's only main-content landmark, and
    // the skip link in Sidebar targets it.
    <main id="main-content" key={pathname} className="content route-fade" tabIndex={-1}>
      {children}
    </main>
  );
}

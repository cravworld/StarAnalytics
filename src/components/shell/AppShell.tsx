import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TopbarExportProvider } from "./TopbarExportContext";
import { RouteTransition } from "./RouteTransition";
import { PipelineHealthBanner } from "@/components/ui/PipelineHealthBanner";

export async function AppShell({ children }: { children: ReactNode }) {
  // Was a hardcoded "24" left over from the Phase 0 prototype — wired to a real count
  // (active tracked fan pages) so the sidebar badge never disagrees with the screen
  // it points to.
  const fanPageCount = await prisma.fanPage.count({ where: { isActive: true } });

  return (
    <TopbarExportProvider>
      <Sidebar fanPageCount={fanPageCount} />
      <div className="main">
        <Topbar />
        <RouteTransition>
          {/* Inside RouteTransition so it sits in the content column and fades with the
              route, rather than pinning a red bar above the topbar on every screen. */}
          <PipelineHealthBanner />
          {children}
        </RouteTransition>
      </div>
    </TopbarExportProvider>
  );
}

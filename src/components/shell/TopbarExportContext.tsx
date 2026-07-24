"use client";

// Lets a page register a real CSV export with the Topbar's global "Export" button,
// without Topbar (rendered once at the shell level, above every route) needing to know
// about any page's data. Only pages with real (non-mock) tabular data register a handler —
// see AGENTS.md's "not evaluated, not fabricated" discipline: Dashboard/Content/Audience
// stay on mock InstagramInsights until Phase 7, so their Export stays disabled rather than
// exporting fabricated numbers.
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface ExportConfig {
  filename: string;
  csv: () => string;
}

const TopbarExportContext = createContext<{
  config: ExportConfig | null;
  setConfig: (config: ExportConfig | null) => void;
} | null>(null);

export function TopbarExportProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ExportConfig | null>(null);
  return <TopbarExportContext.Provider value={{ config, setConfig }}>{children}</TopbarExportContext.Provider>;
}

export function useTopbarExportConfig() {
  const ctx = useContext(TopbarExportContext);
  if (!ctx) throw new Error("useTopbarExportConfig must be used within TopbarExportProvider");
  return ctx;
}

// Registers this page's export while mounted, clearing it on navigation away — so the
// Topbar's Export button only ever reflects the currently-viewed page's real data.
export function useTopbarExport(config: ExportConfig | null) {
  const { setConfig } = useTopbarExportConfig();
  // config.csv is a closure over page state (search/sort/filters) that changes every
  // render — re-registering on every change is what keeps an export triggered a moment
  // after typing in a search box reflect what's on screen, not a stale first render.
  const csv = config?.csv;
  const filename = config?.filename;
  const register = useCallback(() => {
    if (filename && csv) setConfig({ filename, csv });
    else setConfig(null);
  }, [filename, csv, setConfig]);

  useEffect(() => {
    register();
    return () => setConfig(null);
  }, [register, setConfig]);
}

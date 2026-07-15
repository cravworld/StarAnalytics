import { getNotifierProvider } from "@/lib/providers";
import { ALERTS, FAN_PAGES } from "@/lib/providers/seed";

// 24 fan pages are tracked; FAN_PAGES seeds only the 5 the prototype lists, the same way
// the agency table shows "10 of 500 posts". The tab label must use this total, not
// FAN_PAGES.length — otherwise the screen contradicts its own "18/24" KPI and the
// sidebar's "24" badge. Becomes a real count when the provider goes live.
const TRACKED_FAN_PAGE_COUNT = 24;

export async function getFanPagesData() {
  return {
    fanPages: FAN_PAGES,
    totalTracked: TRACKED_FAN_PAGE_COUNT,
    kpis: { totalReach: "4.8M", activeToday: "18/24", postingVijayam: "21/24" },
    alerts: ALERTS,
  };
}

export async function notifyFanPageAlert(message: string) {
  await getNotifierProvider().send({
    id: `alert-${Date.now()}`,
    type: "fan_page_hashtag",
    message,
    createdAt: new Date().toISOString(),
  });
}

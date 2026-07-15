import { getNotifierProvider } from "@/lib/providers";
import { ALERTS, FAN_PAGES } from "@/lib/providers/seed";

export async function getFanPagesData() {
  return {
    fanPages: FAN_PAGES,
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

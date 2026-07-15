import { getPublicContentProvider } from "@/lib/providers";
import { CAMPAIGNS, TRACKED_HASHTAGS, VIJAYAM_DETAIL } from "@/lib/providers/seed";

export async function getOwnCampaigns() {
  return {
    campaigns: CAMPAIGNS,
    kpis: { active: 2, totalHashtagReach: "28.4M", hashtagsTracked: 8 },
  };
}

export async function getVijayamDetail() {
  // Live post stream is backed by scrapeByHashtag; Phase 2 wires Supabase Realtime
  // so this list updates without a page refresh.
  await getPublicContentProvider().scrapeByHashtag("#vijayam");
  return VIJAYAM_DETAIL;
}

export async function getTrackedHashtags() {
  return TRACKED_HASHTAGS;
}

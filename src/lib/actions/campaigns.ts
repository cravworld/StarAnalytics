"use server";

import { revalidatePath } from "next/cache";
import { createCampaign, trackHashtag } from "@/lib/data/campaigns";

export async function createCampaignAction(input: {
  name: string;
  status: "live" | "planned";
  hashtags: string[];
  startDate?: string;
  endDate?: string;
  type?: string;
}) {
  const campaign = await createCampaign(input);
  revalidatePath("/campaigns");
  return campaign;
}

export async function trackHashtagAction(tag: string) {
  await trackHashtag(tag);
  revalidatePath("/campaigns/hashtag");
}

"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  addFanPage,
  pullFanPageHistory,
  setFanPageVerified,
  stopTrackingFanPage,
} from "@/lib/data/fanpages";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { requireSession } from "@/lib/require-session";
import type { PlatformId } from "@/lib/providers/types";

export async function addFanPageAction(handle: string, platform: PlatformId = "instagram") {
  await requireSession();
  const postIds = await addFanPage(handle, platform);
  // Comment-scrape + classify queued as a side effect of the ingestion path rather than a
  // manual step someone has to remember — same discipline as trackHashtagAction. Deferred
  // with after() so adding a page returns as soon as the scrape lands, not after Claude
  // has classified everything it pulled.
  if (postIds.length > 0) after(() => queueSentimentClassification(postIds));
  revalidatePath("/fan-pages");
}

// The detail screen's refresh. Re-pulls the page's profile and its 50 most recent posts,
// then classifies whatever came back. Instagram spends a real Apify call here, which is
// exactly why it is a button and not something a page render can trigger.
export async function pullFanPageHistoryAction(id: string) {
  await requireSession();
  const { postCount, postIds } = await pullFanPageHistory(id);
  if (postIds.length > 0) after(() => queueSentimentClassification(postIds));
  revalidatePath("/fan-pages");
  revalidatePath(`/fan-pages/${id}`);
  return { postCount };
}

export async function setFanPageVerifiedAction(id: string, isVerifiedFan: boolean) {
  await requireSession();
  await setFanPageVerified(id, isVerifiedFan);
  revalidatePath("/fan-pages");
  revalidatePath(`/fan-pages/${id}`);
}

export async function stopTrackingFanPageAction(id: string) {
  await requireSession();
  await stopTrackingFanPage(id);
  revalidatePath("/fan-pages");
  revalidatePath(`/fan-pages/${id}`);
}

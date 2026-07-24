"use server";

import { revalidatePath } from "next/cache";
import { addCompetitor, removeCompetitor } from "@/lib/data/compare";
import type { PlatformId } from "@/lib/providers/types";

export async function addCompetitorAction(handle: string, platform: PlatformId = "instagram") {
  await addCompetitor(handle, platform);
  revalidatePath("/compare");
}

export async function removeCompetitorAction(id: string) {
  await removeCompetitor(id);
  revalidatePath("/compare");
}

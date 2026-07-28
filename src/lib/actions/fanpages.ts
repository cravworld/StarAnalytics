"use server";

import { revalidatePath } from "next/cache";
import { addFanPage } from "@/lib/data/fanpages";
import { requireSession } from "@/lib/require-session";
import type { PlatformId } from "@/lib/providers/types";

export async function addFanPageAction(handle: string, platform: PlatformId = "instagram") {
  await requireSession();
  await addFanPage(handle, platform);
  revalidatePath("/fan-pages");
}

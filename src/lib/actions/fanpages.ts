"use server";

import { revalidatePath } from "next/cache";
import { addFanPage } from "@/lib/data/fanpages";

export async function addFanPageAction(handle: string) {
  await addFanPage(handle);
  revalidatePath("/fan-pages");
}

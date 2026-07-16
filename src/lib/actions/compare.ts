"use server";

import { revalidatePath } from "next/cache";
import { addCompetitor, removeCompetitor } from "@/lib/data/compare";

export async function addCompetitorAction(handle: string) {
  await addCompetitor(handle);
  revalidatePath("/compare");
}

export async function removeCompetitorAction(id: string) {
  await removeCompetitor(id);
  revalidatePath("/compare");
}

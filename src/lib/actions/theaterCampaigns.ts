"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import { validateCampaignInput, type CampaignFormInput } from "@/lib/bookmyshow/validation";
import {
  createTheaterCampaign,
  updateTheaterCampaign,
} from "@/lib/data/theaterCampaigns";
import { prisma } from "@/lib/prisma";

// Every action here calls requireSession() first. Server Actions are POST-reachable
// independently of the page that renders them, so a page-level auth check is not a
// boundary — see src/lib/require-session.ts and the Next data-security guide.
//
// Scanning is deliberately NOT here: it is a long-running third-party fetch, and a route
// handler can set its own maxDuration where a Server Action cannot. See
// src/app/api/theater-campaigns/[id]/scan/route.ts.

export type CampaignActionResult =
  | { ok: true; id: string }
  | { ok: false; errors: Record<string, string> };

export async function createTheaterCampaignAction(input: CampaignFormInput): Promise<CampaignActionResult> {
  await requireSession();

  const validated = validateCampaignInput(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const campaign = await createTheaterCampaign(validated.value);
  revalidatePath("/theater-campaigns");
  return { ok: true, id: campaign.id };
}

export async function updateTheaterCampaignAction(
  id: string,
  input: CampaignFormInput,
): Promise<CampaignActionResult> {
  await requireSession();

  // Only the id comes from the client as a reference; everything else is re-validated.
  // The row is re-read here rather than trusted from the form so a well-formed payload
  // cannot address a campaign that does not exist.
  const existing = await prisma.theaterCampaign.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, errors: { form: "That campaign no longer exists." } };

  const validated = validateCampaignInput(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  await updateTheaterCampaign(id, validated.value);
  revalidatePath("/theater-campaigns");
  revalidatePath(`/theater-campaigns/${id}`);
  return { ok: true, id };
}

export async function setCampaignStatusAction(
  id: string,
  status: "active" | "paused" | "archived",
): Promise<{ ok: boolean }> {
  await requireSession();
  if (!["active", "paused", "archived"].includes(status)) return { ok: false };
  await prisma.theaterCampaign.update({ where: { id }, data: { status } });
  revalidatePath("/theater-campaigns");
  revalidatePath(`/theater-campaigns/${id}`);
  return { ok: true };
}

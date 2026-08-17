import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { retryMissingScoutCandidates } from "@/lib/data/scout";

export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { batchId } = await params;
  const result = await retryMissingScoutCandidates(batchId);
  return NextResponse.json(result);
}

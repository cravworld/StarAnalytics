import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recomputeScoutScores } from "@/lib/data/scout";

export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { batchId } = await params;
  const result = await recomputeScoutScores(batchId);
  return NextResponse.json(result);
}

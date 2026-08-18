import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setScoutBatchArchived } from "@/lib/data/scout";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { batchId } = await params;
  const { archived } = await request.json();
  await setScoutBatchArchived(batchId, archived !== false);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getScoutBatch, getScoutRawRows } from "@/lib/data/scout";
import { buildScoutExcelBuffer } from "@/lib/scout/export";

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { batchId } = await params;
  const [batch, rows] = await Promise.all([getScoutBatch(batchId), getScoutRawRows(batchId)]);
  if (!batch) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buffer = buildScoutExcelBuffer(rows);
  const safeName = batch.fileName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="scoutline-${safeName}.xlsx"`,
    },
  });
}

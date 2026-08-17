import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getScoutSettings, updateScoutSettings } from "@/lib/data/scoutSettings";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getScoutSettings());
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  try {
    const settings = await updateScoutSettings(body);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

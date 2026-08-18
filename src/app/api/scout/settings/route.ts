import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getScoutSettings, updateScoutSettings } from "@/lib/data/scoutSettings";
import type { ScoutPlatform } from "@prisma/client";

function parsePlatform(value: string | null): ScoutPlatform {
  return value === "facebook" ? "facebook" : "instagram";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const platform = parsePlatform(new URL(request.url).searchParams.get("platform"));
  return NextResponse.json(await getScoutSettings(platform));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const platform = parsePlatform(new URL(request.url).searchParams.get("platform"));
  const body = await request.json();
  try {
    const settings = await updateScoutSettings(platform, body);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

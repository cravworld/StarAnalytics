// Dev-only proof that the ingestion pipe works end-to-end: trigger a real hashtag
// scrape, normalize, and write to `posts`. Not a shipped UI feature — Phase 2 wires
// the real trigger points (Hashtag Search's "Track" button, etc.).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPublicContentProvider } from "@/lib/providers";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available in production" }, { status: 404 });
  }
  // Defense in depth alongside the NODE_ENV gate above — this triggers a real,
  // metered Apify scrape, so it shouldn't be reachable by an unauthenticated
  // request even in a non-production environment (e.g. a misconfigured preview
  // deploy where NODE_ENV isn't exactly "production").
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { tag } = await request.json().catch(() => ({ tag: null }));
  if (!tag || typeof tag !== "string") {
    return NextResponse.json({ error: "body must be { tag: string }" }, { status: 400 });
  }
  const posts = await getPublicContentProvider().scrapeByHashtag(tag);
  return NextResponse.json({ tag, count: posts.length, posts });
}

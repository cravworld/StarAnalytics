// Shared star mark + OG layout for icon.tsx, apple-icon.tsx, opengraph-image.tsx, and
// twitter-image.tsx.
//
// The star is drawn as an SVG path, not the ★ text glyph — confirmed via an actual build
// (2026-08-18) that satori (ImageResponse's renderer) can't resolve that glyph in this
// environment: it tried to fetch a dynamic font for it and failed ("Failed to download
// dynamic font. Status: 400"), silently rendering a tofu/missing-glyph box instead of a
// star. An SVG path has no font dependency at all, so it can't fail that way.
//
// Colours come from BRAND in lib/palette.ts: satori renders to a PNG with no document
// and no cascade, so a CSS custom property cannot resolve here and every value has to
// be a literal that still lives in one place.
import { BRAND } from "@/lib/palette";

export function StarMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path
        d="M50 5 L61 39 L98 39 L68 60 L79 95 L50 74 L21 95 L32 60 L2 39 L39 39 Z"
        fill={color}
      />
    </svg>
  );
}

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

export function OgImageContent() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 96px",
        background: BRAND.ground,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: 12,
            // A flat highlighter tile rather than the old Instagram purple->pink->orange
            // gradient: the mark reads as a marker swipe, which is this system's brand
            // signal. The star sits on it in ink.
            background: BRAND.mark,
          }}
        >
          <StarMark size={34} color={BRAND.ground} />
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: BRAND.onGround, letterSpacing: -1 }}>
          StarAnalytics
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 26, color: BRAND.muted, maxWidth: 820 }}>
        Social media intelligence — engagement scoring, campaign buzz tracking, and
        talent-scouting analytics for Instagram.
      </div>
    </div>
  );
}

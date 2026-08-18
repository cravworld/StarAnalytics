import { ImageResponse } from "next/og";
import { StarMark } from "@/lib/ogImage";

// Reuses the app's own brand tokens (globals.css: --text near-black ground, the
// purple->pink->orange trio that's already the accent-gradient family here since this whole
// dashboard is Instagram-focused) rather than inventing a new palette — a star for "Star"
// Analytics, not a decorative shape.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0f14",
          borderRadius: 7,
        }}
      >
        <StarMark size={20} color="#E1306C" />
      </div>
    ),
    { ...size },
  );
}

import { ImageResponse } from "next/og";
import { StarMark } from "@/lib/ogImage";
import { BRAND } from "@/lib/palette";

// The app mark, drawn from the shared palette rather than a locally-invented one:
// a highlighter-yellow star on an ink ground. A star for "Star" Analytics, not a
// decorative shape. It used to be the Instagram purple->pink->orange gradient, which
// made sense while the accent was Instagram pink and made none once it wasn't.
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
          background: BRAND.ground,
          borderRadius: 6,
        }}
      >
        <StarMark size={20} color={BRAND.mark} />
      </div>
    ),
    { ...size },
  );
}

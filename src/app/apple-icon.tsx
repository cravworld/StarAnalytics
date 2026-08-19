import { ImageResponse } from "next/og";
import { StarMark } from "@/lib/ogImage";
import { BRAND } from "@/lib/palette";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        }}
      >
        <StarMark size={108} color={BRAND.mark} />
      </div>
    ),
    { ...size },
  );
}

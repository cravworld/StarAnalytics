import { ImageResponse } from "next/og";
import { StarMark } from "@/lib/ogImage";

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
          backgroundImage: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)",
        }}
      >
        <StarMark size={108} color="#fff" />
      </div>
    ),
    { ...size },
  );
}

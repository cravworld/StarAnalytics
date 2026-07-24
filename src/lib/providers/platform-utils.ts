// Shared between compare.ts's competitor tracking and fanpages.ts's fan-channel tracking —
// both need the same "which platform, which handle rules, which provider" logic.
import { getPublicContentProvider, getYouTubeContentProvider } from "@/lib/providers";
import type { PlatformId } from "./types";

export const PLATFORM_HANDLE_VALIDATORS: Record<PlatformId, { pattern: RegExp; label: string }> = {
  instagram: { pattern: /^[a-zA-Z0-9._]{1,30}$/, label: "Instagram" },
  youtube: { pattern: /^[a-zA-Z0-9._-]{3,30}$/, label: "YouTube" },
};

export function contentProviderFor(platform: PlatformId) {
  return platform === "youtube" ? getYouTubeContentProvider() : getPublicContentProvider();
}

// Shared between compare.ts's competitor tracking and fanpages.ts's fan-channel tracking —
// both need the same "which platform, which handle rules, which provider" logic.
import { getPublicContentProvider, getYouTubeContentProvider } from "@/lib/providers";
import type { PlatformId } from "./types";

// The validators themselves now live in handle-input.ts, which has no provider imports, so the
// bulk-add client component can share them. Re-exported here because every existing server-side
// call site imports them from this module alongside contentProviderFor.
export { PLATFORM_HANDLE_VALIDATORS } from "./handle-input";

export function contentProviderFor(platform: PlatformId) {
  return platform === "youtube" ? getYouTubeContentProvider() : getPublicContentProvider();
}

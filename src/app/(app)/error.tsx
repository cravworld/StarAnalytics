"use client";

import { ScreenError } from "@/components/ui/ScreenStates";

export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <ScreenError message={error.message} />;
}

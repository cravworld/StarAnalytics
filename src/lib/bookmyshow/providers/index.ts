// Provider selection, following the same DATA_MODE_* convention as
// src/lib/providers/index.ts — each source flips mock -> live independently once its
// credential and configuration are in place.
//
// DATA_MODE_BOOKMYSHOW defaults to "mock" and must stay that way until an Apify browser
// actor has been shown to load a BookMyShow showtime page successfully. See
// BOOKMYSHOW-FEASIBILITY.md §8 — that question is still open.

import { ApifyBookMyShowProvider } from "./apify";
import { MockBookMyShowProvider } from "./mock";
import type { BookMyShowProvider } from "../types";

export function getBookMyShowProvider(): BookMyShowProvider {
  return isBookMyShowLive() ? new ApifyBookMyShowProvider() : new MockBookMyShowProvider();
}

export function isBookMyShowLive(): boolean {
  return process.env.DATA_MODE_BOOKMYSHOW === "live";
}

/**
 * Separate from the mock/live switch on purpose.
 *
 * `DATA_MODE_BOOKMYSHOW=live` says "a real scan is wired up and works"; this says
 * "scheduled scanning is allowed to run on its own". Keeping them apart means a manual
 * "Scan now" can be exercised against the live provider without simultaneously turning on
 * an unattended cron that would hit BookMyShow every 90 minutes.
 */
export function isMonitoringEnabled(): boolean {
  return process.env.BOOKMYSHOW_MONITORING_ENABLED === "true";
}

/**
 * Why a live scan cannot run right now, or null if it can.
 *
 * Returned as a message rather than a boolean so the UI can tell the user which specific
 * thing is missing instead of a generic "not configured".
 */
export function bookMyShowConfigError(): string | null {
  if (!isBookMyShowLive()) return null; // mock mode is a valid, fully-working configuration
  if (!process.env.APIFY_TOKEN) {
    return "APIFY_TOKEN is not set — required for live BookMyShow scans.";
  }
  return null;
}

export { ApifyBookMyShowProvider, MockBookMyShowProvider };

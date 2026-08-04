import { ApifyPublicContentProvider } from "./apify-public-content";
import { ClaudeSentimentProvider, sentimentModelId } from "./claude-sentiment";
import { EmailNotifierProvider } from "./email-notifier";
import { GraphInstagramInsightsProvider } from "./graph-instagram-insights";
import { MockInstagramInsightsProvider } from "./mock-instagram-insights";
import { MockNotifierProvider } from "./mock-notifier";
import { MockPublicContentProvider } from "./mock-public-content";
import { MockSentimentProvider } from "./mock-sentiment";
import { MockYouTubePublicContentProvider } from "./mock-youtube-public-content";
import { YouTubePublicContentProvider } from "./youtube-public-content";
import type { DataMode } from "./types";

// Each source flips mock -> live independently as its credential arrives
// (DATA_MODE_INSTAGRAM, DATA_MODE_APIFY, DATA_MODE_SENTIMENT, DATA_MODE_NOTIFIER).
// Only "mock" is implemented in Phase 0 — live implementations land in Phases 1, 4, 7.
function modeFor(envVar: string): DataMode {
  return process.env[envVar] === "live" ? "live" : "mock";
}

export function getInstagramInsightsProvider() {
  const mode = modeFor("DATA_MODE_INSTAGRAM");
  if (mode === "live") {
    return new GraphInstagramInsightsProvider();
  }
  return new MockInstagramInsightsProvider();
}

// Single source of truth for "is the self-account Instagram pipeline actually live" — Phase 7
// (Meta App Review + Business/Creator account conversion) has never been completed, so this is
// false in every real deployment today. Pages showing InstagramInsightsProvider data use this
// to render a "Pending Meta App Review" badge instead of presenting mock numbers as real.
export function isInstagramInsightsLive(): boolean {
  return modeFor("DATA_MODE_INSTAGRAM") === "live";
}

export function getPublicContentProvider() {
  const mode = modeFor("DATA_MODE_APIFY");
  if (mode === "live") {
    return new ApifyPublicContentProvider();
  }
  return new MockPublicContentProvider();
}

// Separate mode switch from Instagram's (DATA_MODE_YOUTUBE, not DATA_MODE_APIFY) — YouTube
// isn't Apify-backed at all, it's a direct call to the official Data API v3. Kept as its
// own provider slot (not folded into getPublicContentProvider) since callers need to pick
// a platform explicitly, not get one swapped in behind a single function.
export function getYouTubeContentProvider() {
  const mode = modeFor("DATA_MODE_YOUTUBE");
  if (mode === "live") {
    return new YouTubePublicContentProvider();
  }
  return new MockYouTubePublicContentProvider();
}

export function getSentimentProvider() {
  const mode = modeFor("DATA_MODE_SENTIMENT");
  if (mode === "live") {
    return new ClaudeSentimentProvider();
  }
  return new MockSentimentProvider();
}

// The exact model string sentiment rows should be stamped with — mirrors getSentimentProvider's
// own mode switch so the two never disagree about which provider actually ran.
export function getSentimentModelId(): string {
  return modeFor("DATA_MODE_SENTIMENT") === "live" ? sentimentModelId() : "mock-sentiment";
}

// DPR §8 Q13 (alert delivery channel) is decided: email, via Resend, once
// RESEND_API_KEY/ALERT_EMAIL_FROM/ALERT_EMAIL_TO are set and DATA_MODE_NOTIFIER flips
// to "live" — same "flip the mode once the credential lands" pattern as sentiment.
export function getNotifierProvider() {
  const mode = modeFor("DATA_MODE_NOTIFIER");
  if (mode === "live") {
    return new EmailNotifierProvider();
  }
  return new MockNotifierProvider();
}

// Mirrors getSentimentModelId()'s pattern — lets callers stamp Alert.channel with the
// exact channel a send was attempted on, without duplicating the mode lookup.
export function getNotifierChannel(): string {
  return modeFor("DATA_MODE_NOTIFIER") === "live" ? "email" : "console";
}

export * from "./types";

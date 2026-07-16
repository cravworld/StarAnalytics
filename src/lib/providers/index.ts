import { ApifyPublicContentProvider } from "./apify-public-content";
import { ClaudeSentimentProvider, sentimentModelId } from "./claude-sentiment";
import { MockInstagramInsightsProvider } from "./mock-instagram-insights";
import { MockNotifierProvider } from "./mock-notifier";
import { MockPublicContentProvider } from "./mock-public-content";
import { MockSentimentProvider } from "./mock-sentiment";
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
    throw new Error("Live InstagramInsightsProvider not implemented until Phase 7.");
  }
  return new MockInstagramInsightsProvider();
}

export function getPublicContentProvider() {
  const mode = modeFor("DATA_MODE_APIFY");
  if (mode === "live") {
    return new ApifyPublicContentProvider();
  }
  return new MockPublicContentProvider();
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

export function getNotifierProvider() {
  const mode = modeFor("DATA_MODE_NOTIFIER");
  if (mode === "live") {
    throw new Error("Live NotifierProvider not implemented until Phase 5.");
  }
  return new MockNotifierProvider();
}

export * from "./types";

import type { SentimentProvider, SentimentResult } from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockSentimentProvider implements SentimentProvider {
  async classify(posts: { id: string; text: string }[]): Promise<SentimentResult[]> {
    await delay(60);
    return posts.map((p) => ({
      id: p.id,
      label: "pos",
      score: 0.78,
      keywords: ["excited", "fire", "blockbuster"],
      model: "mock-sentiment",
    }));
  }
}

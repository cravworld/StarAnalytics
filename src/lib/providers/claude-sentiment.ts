// Direct Claude API call — plain fetch to /v1/messages, deliberately not routed through any
// SDK or the multi-model orchestration infra used elsewhere in the project (see AGENTS.md
// Phase 4 §B0). Kept simple and isolated to this one feature.
import type { SentimentProvider, SentimentResult } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Model string is env-configurable (not hardcoded) precisely because model names/versions
// change — confirm the current one against Anthropic API docs at build time rather than
// trusting this default forever. Bumped to claude-opus-4-8 (from claude-sonnet-5) once a paid
// key was in place — code-mixed Malayalam/English/slang sentiment benefits from the stronger
// model, and batch size here is small enough that the cost difference doesn't matter.
const DEFAULT_MODEL = "claude-opus-4-8";

function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set — required for the live SentimentProvider");
  return key;
}

function model(): string {
  return process.env.ANTHROPIC_SENTIMENT_MODEL || DEFAULT_MODEL;
}

// Exposed so the orchestration layer (src/lib/data/sentiment.ts) can stamp `sentiment.model`
// with the exact string used — same "know which posts were scored under which approach"
// principle as thresholdConfigVersion in Phase 3 — without duplicating the env lookup.
export function sentimentModelId(): string {
  return model();
}

const SYSTEM_PROMPT = `You are classifying sentiment and extracting keywords from Instagram captions and comments about Malayalam film/celebrity campaigns.

Think it through, don't pattern-match. For each item, reason about what this specific commenter's underlying attitude toward the movie/actor/campaign actually is — never just the literal emotional tone of the words. The same surface-level sadness, hype word, or slang term can mean completely different things depending on what it's actually aimed at and whether it's meant literally. Before assigning a label, work through:
1. What is this comment actually about — the film's story/characters/themes, or the film/actor/campaign's own quality?
2. Is the commenter expressing admiration, engagement, nostalgia, or appreciation — or are they actually criticizing, disappointed in, or dismissive of the movie/actor/campaign itself?
3. Could this be sarcastic, negated, or ironic rather than literal?

Only label something "neg" when it reflects real criticism or disappointment aimed at the movie/actor/campaign — bad acting, weak plot, "waste of money/time", boring, trolling, hate. Emotional content that isn't a judgment of quality (sadness, nostalgia, longing, excitement, humor) is "pos" or "neu" depending on how engaged/appreciative it reads, even when the words themselves sound negative.

Below are examples of applying that reasoning — treat them as illustrations of the thinking, not an exhaustive checklist of rules to match against. The same judgment applies to anything you encounter, including patterns not listed here:
- Many of these films (romance, tragedy, heartbreak dramas — "Premam" is a real example) are ABOUT sadness, loss, and unrequited love. A wistful, nostalgic, or tearful comment quoting or riffing on the film's themes ("she'll always be mine, only in my memories 🖤", "some people don't leave your heart, they just leave your life") is a fan moved by the story, not a critic of it — that's positive-to-neutral engagement despite the sad words.
- Fan-culture slang ("mass", "adipoli", "pwoli", "goosebumps", "blockbuster", "fire") signals intensity/positivity — but check whether it's negated or sarcastic first ("not mass", "adipoli aayirunnu ennu paranja aarelum?" said mockingly, "blockbuster 😒") — those are neg despite the hype word.
- Emoji-only or very short inputs ("🔥🔥🔥", "👍") still carry a real signal from the emoji's tone — don't default to neutral just because there's little text.
- If a comment mixes reactions (e.g. praising the actor but criticizing the trailer's pacing), weigh which one is dominant and let "keywords" capture both sides.

The text is a mix of romanized Malayalam, Malayalam script, English, and emojis — often all three within the same caption or across a caption and its comments.

For each input item, return:
- "label": one of "pos", "neu", "neg"
- "score": a 0-1 number for confidence/intensity of that label (not just positive/negative — how strongly positive, neutral, or negative)
- "keywords": a short list (3-6) of extracted terms/phrases that best capture the reaction — short fan-culture phrases are fine ("can't wait", "goosebumps"), not full sentences

Respond with JSON only — a single JSON array, no markdown code fences, no preamble or explanation. The array must have exactly one object per input item, in this shape, with "id" copied exactly from the input:
[{"id": "...", "label": "pos", "score": 0.8, "keywords": ["...", "..."]}]`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseResponse(text: string, expectedIds: string[]): SentimentResult[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const byId = new Map<string, SentimentResult>();
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      ["pos", "neu", "neg"].includes((entry as Record<string, unknown>).label as string) &&
      typeof (entry as Record<string, unknown>).score === "number" &&
      Array.isArray((entry as Record<string, unknown>).keywords)
    ) {
      const e = entry as { id: string; label: "pos" | "neu" | "neg"; score: number; keywords: unknown[] };
      byId.set(e.id, { id: e.id, label: e.label, score: e.score, keywords: e.keywords.map(String) });
    }
  }

  if (!expectedIds.every((id) => byId.has(id))) return null;
  return expectedIds.map((id) => byId.get(id)!);
}

async function callClaude(batch: { id: string; text: string }[]): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: model(),
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(batch) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude sentiment call failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const textBlock = (json.content as { type: string; text?: string }[]).find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

// If parsing fails or the returned array doesn't cover every input id, retry the batch split
// in half rather than failing the whole job silently — see AGENTS.md Phase 4 §B1.
async function classifyBatch(batch: { id: string; text: string }[]): Promise<SentimentResult[]> {
  const responseText = await callClaude(batch);
  const parsed = parseResponse(responseText, batch.map((b) => b.id));
  if (parsed) return parsed;

  if (batch.length <= 1) {
    throw new Error(`Claude sentiment: failed to parse a valid response for post ${batch[0]?.id}`);
  }
  const mid = Math.ceil(batch.length / 2);
  const [left, right] = await Promise.all([
    classifyBatch(batch.slice(0, mid)),
    classifyBatch(batch.slice(mid)),
  ]);
  return [...left, ...right];
}

export class ClaudeSentimentProvider implements SentimentProvider {
  async classify(posts: { id: string; text: string }[]): Promise<SentimentResult[]> {
    if (posts.length === 0) return [];
    return classifyBatch(posts);
  }
}

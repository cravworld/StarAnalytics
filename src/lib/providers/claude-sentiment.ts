// Sentiment classification with a cross-provider fallback chain: Claude -> OpenAI ->
// Gemini, tried in that order whenever the previous provider's call fails for any reason
// (rate limit, insufficient credits, network error, or an unparseable response after that
// provider's own retry-by-splitting bottoms out). Added 2026-07-31 after the Anthropic key
// genuinely ran out of credits mid-session (confirmed via a live call: "Your credit balance
// is too low to access the Anthropic API") while classification was actively backlogged —
// this isn't a defensive nicety, it was observed actually happening in production.
// All three are plain fetch calls, deliberately not routed through any SDK — see AGENTS.md
// Phase 4 §B0. Kept isolated to this one feature.
import type { SentimentProvider, SentimentResult } from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// Model strings are env-configurable (not hardcoded) precisely because model names/
// versions change — confirm the current one against each provider's docs before trusting
// these defaults forever.
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
// OpenAI/Gemini model IDs below were confirmed via real live test calls on 2026-07-31 (both
// correctly classified code-mixed Malayalam/English test cases) — not guessed from training
// data, which is stale for both providers as of this date (both have moved to newer unified
// API shapes: OpenAI's /v1/responses, Gemini's /v1beta/interactions).
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

function anthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set — required for the live SentimentProvider");
  return key;
}
function openaiApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set — required for the OpenAI fallback");
  return key;
}
function geminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — required for the Gemini fallback");
  return key;
}

function anthropicModel(): string {
  return process.env.ANTHROPIC_SENTIMENT_MODEL || DEFAULT_ANTHROPIC_MODEL;
}
function openaiModel(): string {
  return process.env.OPENAI_SENTIMENT_MODEL || DEFAULT_OPENAI_MODEL;
}
function geminiModel(): string {
  return process.env.GEMINI_SENTIMENT_MODEL || DEFAULT_GEMINI_MODEL;
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

// Accepts either shape: a bare JSON array (what Claude's prompt asks for) or an
// object-wrapped `{ "results": [...] }` array (what OpenAI's and Gemini's structured-output
// schemas require — both need a top-level object, not a bare array). Same reasoning
// content either way; only the wire wrapper differs per provider's API constraints.
function parseResponse(
  text: string,
  expectedIds: string[],
  model: string,
): SentimentResult[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    return null;
  }
  const arr: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).results)
      ? ((parsed as Record<string, unknown>).results as unknown[])
      : null;
  if (!arr) return null;

  const byId = new Map<string, SentimentResult>();
  for (const entry of arr) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      ["pos", "neu", "neg"].includes((entry as Record<string, unknown>).label as string) &&
      typeof (entry as Record<string, unknown>).score === "number" &&
      Array.isArray((entry as Record<string, unknown>).keywords)
    ) {
      const e = entry as { id: string; label: "pos" | "neu" | "neg"; score: number; keywords: unknown[] };
      byId.set(e.id, { id: e.id, label: e.label, score: e.score, keywords: e.keywords.map(String), model });
    }
  }

  if (!expectedIds.every((id) => byId.has(id))) return null;
  return expectedIds.map((id) => byId.get(id)!);
}

async function callClaude(batch: { id: string; text: string }[]): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: anthropicModel(),
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      // Identical on every single call (both the post- and comment-level pipelines share
      // this one call site), so it's the textbook prompt-caching case. Cache reads are
      // ~0.1x the input price. If SYSTEM_PROMPT is ever shortened below the model's
      // cacheable-prefix minimum (1024 tokens on claude-opus-4-8), this silently stops
      // caching rather than erroring — verify via response.usage.cache_read_input_tokens.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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

// Shared JSON Schema for the two fallback providers' structured-output modes — both
// require a top-level object, hence the `results` wrapper (see parseResponse above).
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string", enum: ["pos", "neu", "neg"] },
          score: { type: "number" },
          keywords: { type: "array", items: { type: "string" } },
        },
        required: ["id", "label", "score", "keywords"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

async function callOpenAI(batch: { id: string; text: string }[]): Promise<string> {
  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey()}`,
    },
    body: JSON.stringify({
      model: openaiModel(),
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(batch) },
      ],
      text: {
        format: { type: "json_schema", name: "sentiment_results", schema: RESULT_SCHEMA, strict: true },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI sentiment call failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const output = json.output as { type: string; content?: { type: string; text?: string }[] }[];
  const message = output.find((o) => o.type === "message");
  const textBlock = message?.content?.find((c) => c.type === "output_text");
  return textBlock?.text ?? "";
}

async function callGemini(batch: { id: string; text: string }[]): Promise<string> {
  const res = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiApiKey(),
    },
    body: JSON.stringify({
      model: geminiModel(),
      // Gemini's interactions endpoint takes a single string input, not a role-tagged
      // messages array — confirmed via a real live call, not assumed. Prefixing the
      // system prompt onto the batch inline reproduces the same instructions.
      input: `${SYSTEM_PROMPT}\n\nClassify this batch of items:\n${JSON.stringify(batch)}`,
      response_format: { type: "text", mime_type: "application/json", schema: RESULT_SCHEMA },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini sentiment call failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  // Real response shape (confirmed live, differs from the docs' summary): a `steps` array
  // mixing `type: "thought"` (reasoning trace, ignore) and `type: "model_output"` (the
  // actual answer) entries; the latter's `content` holds the text block.
  const steps = json.steps as { type: string; content?: { type: string; text?: string }[] }[];
  const modelOutput = steps?.find((s) => s.type === "model_output");
  const textBlock = modelOutput?.content?.find((c) => c.type === "text");
  return textBlock?.text ?? "";
}

const PROVIDERS: { name: string; model: () => string; call: (batch: { id: string; text: string }[]) => Promise<string> }[] = [
  { name: "Claude", model: anthropicModel, call: callClaude },
  { name: "OpenAI", model: openaiModel, call: callOpenAI },
  { name: "Gemini", model: geminiModel, call: callGemini },
];

// Per-provider retry-by-splitting-in-half on a parse failure (see AGENTS.md Phase 4 §B1) —
// unchanged in spirit from the original single-provider version, just parameterized over
// which provider is currently being tried so the fallback loop below can reuse it.
async function classifyBatchWithProvider(
  provider: (typeof PROVIDERS)[number],
  batch: { id: string; text: string }[],
): Promise<SentimentResult[]> {
  const modelId = provider.model();
  const responseText = await provider.call(batch);
  const parsed = parseResponse(responseText, batch.map((b) => b.id), modelId);
  if (parsed) return parsed;

  if (batch.length <= 1) {
    throw new Error(`${provider.name} sentiment: failed to parse a valid response for post ${batch[0]?.id}`);
  }
  const mid = Math.ceil(batch.length / 2);
  const [left, right] = await Promise.all([
    classifyBatchWithProvider(provider, batch.slice(0, mid)),
    classifyBatchWithProvider(provider, batch.slice(mid)),
  ]);
  return [...left, ...right];
}

// Tries each provider in order (Claude -> OpenAI -> Gemini), moving to the next only if the
// current one fails outright (after its own internal split-retry is exhausted) — a rate
// limit, an exhausted credit balance, a network error, or a response that never parses.
// Not selective about *why* a provider failed: any failure is worse than not trying the
// next one, so this doesn't special-case error types.
async function classifyBatch(batch: { id: string; text: string }[]): Promise<SentimentResult[]> {
  let lastErr: unknown;
  for (const provider of PROVIDERS) {
    try {
      return await classifyBatchWithProvider(provider, batch);
    } catch (err) {
      lastErr = err;
      console.error(`sentiment pipeline: ${provider.name} failed, trying next provider:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class ClaudeSentimentProvider implements SentimentProvider {
  async classify(posts: { id: string; text: string }[]): Promise<SentimentResult[]> {
    if (posts.length === 0) return [];
    return classifyBatch(posts);
  }
}

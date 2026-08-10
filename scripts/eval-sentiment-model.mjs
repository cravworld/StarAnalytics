// One-off manual eval: compares claude-opus-4-8 against claude-sonnet-5 on a small set of
// hard sentiment cases (sarcasm, negation, wistful-but-not-negative romance/tragedy content,
// emoji-only, mixed reactions) before trusting a model swap in production.
//
// Context: README documents that Sonnet was tried here before (2026-07-24) and moved off
// because it misclassified wistful/sad-but-not-critical comments as negative ("Premam"-style
// heartbreak content). That finding predates Sonnet 5 (launched shortly before this eval,
// per its intro-pricing window) — this script exists to check whether that finding still
// holds on the current model before deciding to keep or revert the swap in
// src/lib/providers/claude-sentiment.ts.
//
// Deliberately NOT reusing SYSTEM_PROMPT via import — this is a plain .mjs script (no TS
// loader configured for scripts/), so the prompt below is a manual copy of the one in
// claude-sentiment.ts as of 2026-08-10. If that prompt changes, re-sync before trusting
// this script's results again.
//
// The case set itself IS a single source of truth, not duplicated here — read from
// src/lib/providers/sentimentEval.fixture.json, the same fixture whose shape is checked by
// sentimentEval.fixture.test.ts. Add new hard cases there, not in this file.
//
// Run with: node --env-file=.env.local scripts/eval-sentiment-model.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "../src/lib/providers/sentimentEval.fixture.json");
const CASES = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")).cases;

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODELS = ["claude-opus-4-8", "claude-sonnet-5"];

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

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (expected in .env.local)");
  return key;
}

function stripJsonFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function classify(model, batch) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: JSON.stringify(batch.map(({ id, text }) => ({ id, text }))) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`${model} call failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const textBlock = json.content.find((b) => b.type === "text");
  const parsed = JSON.parse(stripJsonFences(textBlock?.text ?? ""));
  const arr = Array.isArray(parsed) ? parsed : parsed.results;
  const byId = new Map(arr.map((e) => [e.id, e]));
  return batch.map((c) => byId.get(c.id));
}

async function main() {
  console.log(`Evaluating ${MODELS.join(" vs ")} on ${CASES.length} hard cases...\n`);

  const results = {};
  for (const model of MODELS) {
    results[model] = await classify(model, CASES);
  }

  const rows = CASES.map((c, i) => {
    const row = { case: c.id, expected: c.expected, trap: c.trap };
    for (const model of MODELS) {
      const r = results[model][i];
      row[model] = r ? `${r.label} (${r.score})` : "PARSE FAIL";
      row[`${model}_correct`] = r?.label === c.expected;
    }
    return row;
  });

  console.table(
    rows.map(({ trap: _trap, ...r }) => r),
  );

  for (const model of MODELS) {
    const correct = rows.filter((r) => r[`${model}_correct`]).length;
    console.log(`${model}: ${correct}/${CASES.length} correct`);
  }

  const divergent = rows.filter((r) => MODELS.some((m) => r[m] !== r[MODELS[0]]));
  if (divergent.length > 0) {
    console.log(`\n${divergent.length} case(s) where models disagree:`);
    for (const r of divergent) {
      console.log(`  [${r.case}] expected=${r.expected} — ${MODELS.map((m) => `${m}=${r[m]}`).join(", ")}`);
      console.log(`    trap: ${CASES.find((c) => c.id === r.case).trap}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

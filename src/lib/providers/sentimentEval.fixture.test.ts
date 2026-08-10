// Pure-function integrity check for the sentiment eval fixture — no API calls, no DOM, no DB
// (fits this project's vitest scope, see vitest.config.ts). Actually running the fixture
// against a live model is scripts/eval-sentiment-model.mjs, which is deliberately NOT part
// of this suite since it spends real API credits on every run.
import { describe, expect, it } from "vitest";
import fixture from "./sentimentEval.fixture.json";

type EvalCase = {
  id: string;
  text: string;
  expected: string;
  trap: string;
  source: string;
};

const cases = fixture.cases as EvalCase[];
const validLabels = new Set(fixture.labels);
const validSources = new Set(Object.keys(fixture.sources));

describe("sentiment eval fixture", () => {
  it("is non-empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("has unique case ids", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case has non-empty text and trap fields", () => {
    for (const c of cases) {
      expect(c.text.trim(), `case ${c.id} has empty text`).not.toBe("");
      expect(c.trap.trim(), `case ${c.id} has empty trap description`).not.toBe("");
    }
  });

  it("every case's expected label is one of the declared labels", () => {
    for (const c of cases) {
      expect(validLabels.has(c.expected), `case ${c.id} has unrecognized expected label "${c.expected}"`).toBe(true);
    }
  });

  it("every case's source is a documented source", () => {
    for (const c of cases) {
      expect(validSources.has(c.source), `case ${c.id} has unrecognized source "${c.source}"`).toBe(true);
    }
  });

  it("includes at least one documented-regression case", () => {
    // The fixture exists specifically to catch the README-documented wistful/sad-but-not-
    // critical misclassification — losing every case tagged this way would defeat the point.
    expect(cases.some((c) => c.source === "documented-regression")).toBe(true);
  });
});

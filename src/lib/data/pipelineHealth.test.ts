import { describe, it, expect } from "vitest";
import { classifyPipelineHealth, STALE_AFTER_HOURS, DOWN_AFTER_HOURS } from "./pipelineHealth";

const NOW = new Date("2026-08-07T06:00:00Z").getTime();
const HOUR = 3_600_000;
const agoHours = (h: number) => new Date(NOW - h * HOUR);

describe("classifyPipelineHealth", () => {
  it("is ok within the stale threshold", () => {
    expect(classifyPipelineHealth({ lastSuccessAt: agoHours(1), quotaExhausted: false, now: NOW })).toBe("ok");
  });

  it("is stale from the threshold up to the down threshold", () => {
    expect(
      classifyPipelineHealth({ lastSuccessAt: agoHours(STALE_AFTER_HOURS), quotaExhausted: false, now: NOW }),
    ).toBe("stale");
    expect(classifyPipelineHealth({ lastSuccessAt: agoHours(11), quotaExhausted: false, now: NOW })).toBe("stale");
  });

  it("is down at and past the down threshold", () => {
    expect(
      classifyPipelineHealth({ lastSuccessAt: agoHours(DOWN_AFTER_HOURS), quotaExhausted: false, now: NOW }),
    ).toBe("down");
  });

  // A quota rejection is positive evidence of breakage, so it outranks the age rule —
  // otherwise the cap could be hit two minutes ago and the banner would still read "ok"
  // for another three hours.
  it("is down on a quota rejection even when the last success is recent", () => {
    expect(classifyPipelineHealth({ lastSuccessAt: agoHours(0.1), quotaExhausted: true, now: NOW })).toBe("down");
  });

  it("is down when no successful run has ever been recorded", () => {
    expect(classifyPipelineHealth({ lastSuccessAt: null, quotaExhausted: false, now: NOW })).toBe("down");
  });

  // The actual outage this was built for: last success 2026-07-31T14:05Z, read on
  // 2026-08-07 — seven days of silence rendered as live figures.
  it("reports the real 2026-07-31 outage as down", () => {
    expect(
      classifyPipelineHealth({
        lastSuccessAt: new Date("2026-07-31T14:05:46Z"),
        quotaExhausted: true,
        now: new Date("2026-08-07T06:00:00Z").getTime(),
      }),
    ).toBe("down");
  });
});

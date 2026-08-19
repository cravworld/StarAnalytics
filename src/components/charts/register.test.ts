import { describe, it, expect } from "vitest";
import { defaults } from "chart.js";
import "./register";

/**
 * Guards the crash that shipped to production as:
 *
 *   Uncaught TypeError: this._fn is not a function
 *     at Animation.tick -> Animator._update
 *
 * Chart.js resolves an animation's interpolator with
 *   `cfg.fn || interpolators[cfg.type || typeof from]`
 * and ships interpolators for exactly three types: boolean, color, number.
 *
 * Crucially, Animations.configure only copies the keys that exist on
 * `defaults.animation` into each resolved animation config:
 *
 *   const animationOptions = Object.keys(defaults.animation);
 *   for (const option of animationOptions) resolved[option] = cfg[option];
 *
 * So replacing `defaults.animation` with a fresh `{ duration, easing }` — rather than
 * assigning into it — silently removes `type` and `fn` from that copy list. Colour
 * properties lose their `type: 'color'`, fall back to `typeof from` === "string",
 * find no interpolator, and every colour transition throws on the next frame.
 *
 * The failure is nasty precisely because it is remote from its cause: it fires inside
 * requestAnimationFrame, so it lands on whichever route the user navigated to, which
 * can be a page with no charts on it whatsoever.
 */
describe("chart.js defaults", () => {
  it("keeps the interpolator keys Chart.js needs to resolve an animation type", () => {
    // Not asserting the exact set — Chart.js is free to add keys — but `type` and `fn`
    // are the two that decide which interpolator is used, and losing either is the bug.
    const keys = Object.keys(defaults.animation);
    expect(keys).toContain("type");
    expect(keys).toContain("fn");
  });

  it("still applies the app's own duration and easing", () => {
    // The merge has to actually merge: the point is to keep Chart.js's keys *and* our
    // values, not to quietly revert to the stock 1000ms entry animation.
    const animation = defaults.animation;
    // Under prefers-reduced-motion this is deliberately `false`; the test environment
    // has no matchMedia, so reaching that branch here would mean the guard misfired.
    if (animation === false) throw new Error("animations unexpectedly disabled");
    expect(animation.duration).toBe(320);
    expect(animation.easing).toBe("easeOutQuart");
  });
});

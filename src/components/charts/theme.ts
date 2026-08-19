/**
 * The chart half of the notebook design system.
 *
 * Chart.js cannot read CSS custom properties: it writes colours into a canvas 2D
 * context, which has no element context to resolve `var(--x)` against. So the
 * token values that globals.css owns have to be mirrored here as literals. This
 * module is the ONLY place that is allowed to do that — every chart imports from
 * here, so there is exactly one file to change and `scripts/check-tokens.mjs`
 * whitelists this path alone.
 *
 * Every value below is measured. See globals.css for the full derivation.
 */

/** Card surface. Charts always sit on a card, never on the page's graph grid. */
export const LEAF = "#FBFCF8";

/** The ink. Every primary chart mark is drawn in it — never a pastel. */
export const INK = "#16212C";

/** Axis ticks, legend labels, tooltip body. 7.08:1 on a card. */
export const INK_SOFT = "#48586A";

/**
 * The sequential series ramp: one pencil, four pressures.
 *
 * Ordered darkest→lightest and MONOTONIC IN LUMINANCE (15.82 / 8.95 / 5.16 /
 * 3.05:1 against LEAF), which is what makes it safe: it separates by lightness
 * rather than by hue, so it survives every form of colour-blindness and reads
 * correctly in greyscale. Every step clears the 3:1 floor for a graphical mark.
 *
 * Use this for parts-of-a-whole and for ordered categories. Do NOT swap in four
 * unrelated hues — that was tried and measured, and reserving red/green for
 * semantics while holding 3:1 collapsed the worst pairwise separation to dE 10.
 */
export const SERIES = ["#16212C", "#2C4A66", "#43708F", "#6A97B2"] as const;

/**
 * Semantic colours. Reserved — never used for categorical series, so a chart
 * segment can never be misread as "this one is bad".
 * Separated from each other on two channels: dE 27.7 under deuteranope/protanope
 * simulation, and a 2.07:1 luminance ratio.
 */
export const PENCIL_GREEN = "#217C45";
export const PENCIL_RED = "#81001F";

/** The printed hairline — tooltip border, matching every card edge in the app. */
export const RULE = "#C4D0BC";

/** Printed rules: chart gridlines, at the same weight as the paper's ruling. */
export const GRIDLINE = "rgba(22,33,44,.07)";

/** Translucent ink for the area fill under a line. */
export const INK_FILL = "rgba(22,33,44,.07)";
export const GREEN_FILL = "rgba(33,124,69,.09)";

/**
 * next/font generates hashed family names, so the literal Chart.js needs can only
 * be read at runtime off the element that carries the font variables. Resolved
 * lazily and cached, because this module is evaluated during hydration and the
 * value is only correct once <html> carries the next/font classes.
 *
 * Returns a resolved font list (e.g. `"__IBM_Plex_Mono_abc123", monospace`) that is
 * valid in the CSS font shorthand — a `var()` reference here is silently rejected
 * by the canvas, taking font.size down with it and leaving the chart at the UA
 * default 10px sans-serif.
 */
const MONO_FALLBACK = 'ui-monospace, Menlo, monospace';
let cachedMono: string | null = null;

export function monoFamily(): string {
  if (cachedMono) return cachedMono;
  if (typeof document === "undefined" || !document.documentElement) return MONO_FALLBACK;
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  if (!resolved) return MONO_FALLBACK;
  // Only cache a real answer, so an early call can't pin the fallback forever.
  cachedMono = `${resolved}, ${MONO_FALLBACK}`;
  return cachedMono;
}

/**
 * Axis tick styling shared by every chart: mono, because in this design system
 * every label — including an axis tick — is set in the label voice.
 */
export function tickFont() {
  return { family: monoFamily(), size: 10 };
}

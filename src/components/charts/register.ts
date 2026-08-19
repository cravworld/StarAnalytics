import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  defaults,
} from "chart.js";
import { INK, INK_SOFT, GRIDLINE, RULE, monoFamily } from "./theme";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
);

/**
 * Global Chart.js defaults.
 *
 * Every chart in the app imports this module for its side effect, so this is the
 * one place where chart motion and typography can be made consistent. Previously
 * each chart inherited Chart.js's stock defaults: a 1000ms entry animation (far
 * outside the 200-400ms band the rest of the app moves in), Helvetica, and the
 * default dark tooltip that matches nothing else on screen.
 */

// Chart.js has no notion of prefers-reduced-motion. This module is imported by
// "use client" components, which still evaluate on the server during SSR, so the
// window guard is required — not defensive padding.
const prefersReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 320ms ≈ --dur-slow. easeOutQuart is the closest built-in to the app's
// --ease-out curve: quick departure, soft settle.
defaults.animation = prefersReducedMotion
  ? false
  : { duration: 320, easing: "easeOutQuart" };

// Chart.js re-runs the entry animation on every resize by default, so dragging a
// window edge makes all charts replay. Resizes should be instantaneous.
defaults.transitions.resize.animation.duration = 0;

const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Chart.js writes its font into `canvas` 2D context `ctx.font`, which is parsed by
 * the CSS font shorthand grammar *without any element context*. A `var(--font-sans)`
 * reference therefore cannot resolve, the whole shorthand is rejected, and the
 * assignment is silently ignored — taking `font.size` down with it and leaving
 * every chart at the UA default `10px sans-serif`. Verified in-browser:
 *   ctx.font = "11px var(--font-sans, sans-serif)"  ->  "10px sans-serif"  (rejected)
 *   ctx.font = '11px Inter, "Inter Fallback"'       ->  applied
 * So the family has to be a resolved literal. It is read lazily through a getter
 * because this module is evaluated during hydration and the value is only correct
 * once <body> carries the next/font class.
 */
let cachedFamily: string | null = null;
Object.defineProperty(defaults.font, "family", {
  configurable: true,
  get() {
    if (cachedFamily) return cachedFamily;
    if (typeof document === "undefined" || !document.body) return SYSTEM_STACK;
    const resolved = getComputedStyle(document.body).fontFamily;
    // Only cache a real answer, so an early call can't pin the fallback forever.
    if (resolved) cachedFamily = resolved;
    return resolved || SYSTEM_STACK;
  },
  set(v: string) {
    cachedFamily = v;
  },
});
defaults.font.size = 11;
defaults.color = INK_SOFT;
defaults.borderColor = GRIDLINE;

// Hovering anywhere in the plot area resolves to the nearest point rather than
// requiring a direct hit on a 3px dot.
defaults.interaction.mode = "index";
defaults.interaction.intersect = false;

// A light tooltip consistent with the app's cards, instead of Chart.js's stock
// dark bubble which reads as a foreign element on these screens.
Object.assign(defaults.plugins.tooltip, {
  backgroundColor: "rgba(251,252,248,.97)",
  titleColor: INK,
  bodyColor: INK_SOFT,
  borderColor: RULE,
  borderWidth: 1,
  cornerRadius: 4,
  padding: 10,
  displayColors: true,
  boxPadding: 4,
  titleFont: { size: 12, weight: 600 as const },
  // The tooltip is a label surface, so it takes the label voice.
  footerFont: { family: monoFamily(), size: 10 },
  bodyFont: { size: 11 },
});

defaults.plugins.legend.labels.usePointStyle = true;
defaults.plugins.legend.labels.pointStyle = "rectRounded";
defaults.plugins.legend.labels.boxWidth = 8;
defaults.plugins.legend.labels.padding = 12;

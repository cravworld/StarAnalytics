#!/usr/bin/env node
/**
 * Fails if a colour is hardcoded outside the design-token system.
 *
 * The redesign's real risk is not that a screen looks wrong — it is that a screen
 * looks RIGHT in a screenshot while old hardcoded hexes are still live underneath,
 * waiting to reappear on a state this pass never rendered. A stylesheet swap only
 * reaches rules; it cannot reach the ~275 inline `style` props this app carries.
 *
 * Run:  node scripts/check-tokens.mjs [--module <name>]
 *
 * Exit 0 = every colour in scope comes from a token.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * The only two places allowed to name a colour literally.
 * globals.css defines the palette; charts/theme.ts mirrors it because Chart.js
 * writes into a canvas context and cannot resolve a CSS custom property.
 */
const ALLOWED = new Set([
  join("src", "app", "globals.css"),
  join("src", "components", "charts", "theme.ts"),
  // The identity pencil box. Same rationale: entity colours are consumed by data
  // modules and by Chart.js-adjacent code, so they need to exist as literals once.
  join("src", "lib", "palette.ts"),
]);

/** The pre-redesign Instagram palette. Any survivor is a definite leftover. */
const LEGACY = {
  "#E1306C": "old accent pink",
  "#833AB4": "old purple",
  "#F77737": "old orange",
  "#0f0f14": "old ink",
  "#6b6b84": "old muted",
  "#e7e7ef": "old border",
  "#72728a": "old chart tick",
  "#f7f7fa": "old page background",
};

/** Which files belong to which module, for --module scoping. */
const MODULES = {
  dashboard: [join("src", "app", "(app)", "page.tsx")],
  content: [join("src", "app", "(app)", "content")],
  audience: [join("src", "app", "(app)", "audience")],
  compare: [join("src", "app", "(app)", "compare"), join("src", "components", "compare")],
  campaigns: [join("src", "app", "(app)", "campaigns"), join("src", "components", "campaigns"), join("src", "components", "agency")],
  fanpages: [join("src", "app", "(app)", "fan-pages"), join("src", "components", "fanpages")],
  shell: [join("src", "lib", "palette.ts"), join("src", "components", "shell"), join("src", "components", "ui"), join("src", "components", "charts"), join("src", "app", "layout.tsx"), join("src", "app", "globals.css")],
  login: [join("src", "app", "login")],
};

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const moduleArg = args.includes("--module") ? args[args.indexOf("--module") + 1] : null;
if (moduleArg && !MODULES[moduleArg]) {
  console.error(`Unknown module "${moduleArg}". Known: ${Object.keys(MODULES).join(", ")}`);
  process.exit(2);
}
const scope = moduleArg ? MODULES[moduleArg] : null;

const findings = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOWED.has(rel)) continue;
  if (scope && !scope.some((p) => rel === p || rel.startsWith(p + sep))) continue;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Skip comment-only lines: a hex quoted in prose is documentation, not a value.
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    for (const hit of line.match(HEX) ?? []) {
      findings.push({
        rel,
        line: i + 1,
        hex: hit,
        legacy: LEGACY[hit] ?? LEGACY[hit.toUpperCase()] ?? LEGACY[hit.toLowerCase()] ?? null,
        text: trimmed.slice(0, 100),
      });
    }
  });
}

const label = moduleArg ? `module "${moduleArg}"` : "all of src/";
if (findings.length === 0) {
  console.log(`OK — no hardcoded colours in ${label}. Every colour comes from a token.`);
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.rel)) byFile.set(f.rel, []);
  byFile.get(f.rel).push(f);
}

console.log(`${findings.length} hardcoded colour${findings.length === 1 ? "" : "s"} in ${label}:\n`);
for (const [rel, hits] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${rel}  (${hits.length})`);
  for (const h of hits) {
    console.log(`    ${String(h.line).padStart(4)}: ${h.hex}${h.legacy ? `  <-- LEFTOVER: ${h.legacy}` : ""}`);
  }
  console.log("");
}
const legacyCount = findings.filter((f) => f.legacy).length;
if (legacyCount) console.log(`${legacyCount} of these are the pre-redesign palette still showing through.`);
process.exit(1);

import { test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Captures the original staranalytics_prototype.html — the visual source of truth —
 * so a human can review e2e/screens/* against e2e/reference/shots/* side by side.
 *
 * These are reference artifacts for human eyeballing. They are deliberately NOT
 * pixel-diffed against the app: different DOM, fonts and scroll model would produce
 * false failures that say nothing about fidelity.
 *
 * Scroll model note: the prototype sets body{overflow:hidden} and scrolls an inner
 * .content div, so fullPage screenshots would clip long screens. The port instead
 * scrolls the page body. A tall viewport is used here so the prototype's inner
 * scroller reveals its full content in one shot.
 */

const PROTOTYPE_URL = pathToFileURL(
  path.resolve(__dirname, "../../staranalytics_prototype.html"),
).href;

test.use({ viewport: { width: 1440, height: 2000 } });

// The prototype toggles screens with inline JS rather than routes, so drive its
// own nav elements — same code path a human clicking through it would take.
const VIEWS: { name: string; drive: (page: Page) => Promise<void> }[] = [
  { name: "01-dashboard", drive: async () => {} },
  { name: "02-content", drive: (p) => p.click("#nav-content") },
  { name: "03-audience", drive: (p) => p.click("#nav-audience") },
  { name: "04-compare", drive: (p) => p.click("#nav-compare") },
  { name: "05-campaigns-own", drive: (p) => p.click("#nav-campaigns") },
  {
    name: "06-campaigns-hashtag",
    drive: async (p) => {
      await p.click("#nav-campaigns");
      await p.click("#itab-htag");
    },
  },
  {
    name: "07-agency-upload",
    drive: async (p) => {
      await p.click("#nav-campaigns");
      await p.click("#itab-agency");
    },
  },
  {
    name: "08-agency-scorecard",
    drive: async (p) => {
      await p.click("#nav-campaigns");
      await p.click("#itab-agency");
      await p.evaluate(() => (window as unknown as { runAnalysis: () => void }).runAnalysis());
    },
  },
  {
    name: "09-agency-authenticity",
    drive: async (p) => {
      await p.click("#nav-campaigns");
      await p.click("#itab-agency");
      await p.evaluate(() => (window as unknown as { runAnalysis: () => void }).runAnalysis());
      await p.click("#ag-tab-auth");
    },
  },
  {
    name: "10-agency-posts",
    drive: async (p) => {
      await p.click("#nav-campaigns");
      await p.click("#itab-agency");
      await p.evaluate(() => (window as unknown as { runAnalysis: () => void }).runAnalysis());
      await p.click("#ag-tab-posts");
    },
  },
  {
    name: "11-vijayam-detail",
    drive: async (p) => {
      await p.click("#nav-campaigns");
      await p.evaluate(() => (window as unknown as { openVijayam: () => void }).openVijayam());
    },
  },
  { name: "12-fan-pages", drive: (p) => p.click("#nav-fanpages") },
];

async function waitForChartsSettled(page: Page) {
  if ((await page.locator("canvas").count()) === 0) return;
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __prevCanvasPixels?: string[] };
      const shots = Array.from(document.querySelectorAll("canvas")).map((c) =>
        (c as HTMLCanvasElement).toDataURL(),
      );
      const prev = w.__prevCanvasPixels;
      w.__prevCanvasPixels = shots;
      if (!prev || prev.length !== shots.length) return false;
      return shots.every((s, i) => s === prev[i]);
    },
    null,
    { polling: 250, timeout: 15_000 },
  );
}

for (const view of VIEWS) {
  test(`prototype reference — ${view.name}`, async ({ page }) => {
    await page.goto(PROTOTYPE_URL);
    await view.drive(page);
    await waitForChartsSettled(page);
    await page.screenshot({ path: `e2e/reference/shots/${view.name}.png` });
  });
}

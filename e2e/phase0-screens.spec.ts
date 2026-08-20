import { test, expect, type Page } from "@playwright/test";
import { mintSessionCookie } from "./auth/mintSession";

/**
 * Phase 0 DoD: walk every screen behind the auth guard and prove it renders the
 * seeded mock data, then capture a screenshot for human side-by-side review
 * against staranalytics_prototype.html.
 *
 * Assertion strings are copied from src/lib/providers/seed.ts and the mock
 * providers, so they are deterministic rather than guessed.
 *
 * NOTE: Chart.js paints into <canvas>, so chart axis/series labels are NOT in the
 * DOM. Text assertions target DOM text only; charts are verified by canvas count.
 */

type View = {
  name: string;
  path: string;
  /**
   * Interaction needed after navigation to reach the state being captured. Must stay
   * read-only — see pasteAgencyLinks; nothing in this suite may write to the database.
   */
  setup?: (page: Page) => Promise<void>;
  /** Known mock values that must be visible. */
  text: string[];
  /** Expected mounted Chart.js canvases. */
  canvases?: number;
  /** Extra per-view assertions beyond text/canvas checks. */
  extra?: (page: Page) => Promise<void>;
};

/**
 * Chart.js animates on mount (~1s sweep). Screenshotting before it settles captures
 * half-drawn bars and a partial doughnut arc — which looks like an app bug but isn't.
 * Rather than sleeping a guessed duration, poll until two consecutive samples of every
 * canvas's pixels are identical, i.e. the animation has actually stopped.
 */
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

/**
 * The agency screen starts empty. Its "Agencies in This Upload" card is derived from rows
 * parsed in the browser, so nothing appears until a sheet is dropped or a list is pasted —
 * this view was asserting on that populated state without ever producing it, which is why
 * it failed on strings that could never have rendered.
 *
 * Goes through the real textarea + parsePastedText path rather than stubbing component
 * state, so the parser's own two-column contract is exercised too. Purely client-side:
 * no server action and no Apify call happens until "Analyse All Posts" is clicked.
 *
 * KEEP THIS PASTE-ONLY. Clicking through to the analysis from this suite would write real
 * Agency rows to whatever database the harness is pointed at — phase0 is otherwise entirely
 * read-only, and the default name here ("Pixelwave Media") reads like a genuine client, so
 * those rows would surface in the app's own Agency Report as if they were a real customer.
 * That exact pollution has happened before: three stray agencies were still sitting in
 * production on 2026-08-07, which is why phase3-agency-verify.spec.ts uses throwaway
 * "E2E Agency N" names and deletes them in an afterAll. The analysis flow is covered there,
 * once, with that cleanup — not duplicated here.
 */
const pasteAgencyLinks = async (page: Page, agency = "Pixelwave Media", count = 50) => {
  const lines = Array.from(
    { length: count },
    (_, i) => `${agency},https://instagram.com/p/Seed${String(i).padStart(3, "0")}Abc`,
  ).join("\n");
  const box = page.locator("textarea").first();
  await box.fill(lines);
  await box.blur(); // parsing is wired to onBlur, not onChange
  await expect(page.getByText(`${count} links`)).toBeVisible();
};

const VIEWS: View[] = [
  {
    name: "01-dashboard",
    path: "/",
    text: ["Followers", "7.4M", "Engagement Rate", "4.2%", "Top Posts This Month"],
    canvases: 2, // follower growth line + engagement doughnut
  },
  {
    name: "02-content",
    path: "/content",
    text: ["Best Format", "Reels", "4.8% avg eng", "Fri 7PM", "Recent Posts"],
    canvases: 2, // post-type bar + reach line
  },
  {
    name: "03-audience",
    path: "/audience",
    // "25–34" is an EN DASH in the mock provider, not a hyphen.
    text: ["Top City", "Kochi", "25–34", "44% of followers", "64M / 36F", "Trivandrum"],
    canvases: 1, // age distribution bar
  },
  // Retargeted onto page furniture for the same reason as 13-scoutline: /compare reads
  // competitor_accounts from the DB (see src/lib/data/compare.ts), so "Dulquer Salmaan" was
  // a row from the retired static fixture, not something the screen produces. A competitor
  // appears only once a human adds one, so asserting a name made this suite depend on data
  // no fresh database has. The own-page column and its metric labels DO survive — they come
  // from the Instagram insights provider, which the harness pins to mock.
  //
  // The dropped "—" was the data-honesty check, and it was worth more than it looked, so:
  // with no competitor on screen there is no unavailable metric to render, meaning the
  // assertion could only ever have passed vacuously here. That guard now lives where it
  // bites — phase3-agency-verify.spec.ts asserts the "Saves: N/A" and "Not Evaluated This
  // Phase" markers against real scored posts that genuinely lack those fields.
  {
    name: "04-compare",
    path: "/compare",
    text: ["Compare Pages", "Nivin Pauly", "Followers", "Story Response Rate", "Add account to compare"],
  },
  // 05-campaigns-own and 06-campaigns-hashtag retired in Phase 2: both screens now
  // read from the real `campaigns`/`hashtag_snapshots` tables unconditionally
  // (mock and live mode alike — see src/lib/data/campaigns.ts), not the static
  // CAMPAIGNS/TRACKED_HASHTAGS seed fixtures. A fresh DB has neither, so the
  // fixed seed strings this test asserted on no longer appear by design. Covered
  // instead by e2e/phase2-campaigns.spec.ts against real DB-backed data.
  {
    name: "07-agency-upload",
    path: "/campaigns/agency",
    setup: (page) => pasteAgencyLinks(page),
    // "Agencies in This Upload", not "…in This Campaign": the card was renamed in the
    // component and this assertion was never updated, so the test had been failing on a
    // string that no longer exists rather than on anything actually broken.
    text: ["Upload Agency Post Links", "Agencies in This Upload", "Pixelwave Media", "50 links"],
    extra: async (page) => {
      // The dropzone icon must sit centred over "Drop your sheet here". Tailwind's
      // preflight sets svg{display:block}, which silently defeats .upload-zone's
      // text-align:center and left-pins the icon; the prototype has no such reset.
      // Assert the icon's centre matches the zone's rather than trusting the CSS.
      const zone = await page.locator(".upload-zone").boundingBox();
      const icon = await page.locator(".upload-zone svg").boundingBox();
      if (!zone || !icon) throw new Error("upload zone or its icon did not render");
      expect(Math.abs(icon.x + icon.width / 2 - (zone.x + zone.width / 2))).toBeLessThan(2);
    },
  },
  // 08-agency-scorecard, 09-agency-authenticity and 10-agency-posts retired here — same
  // reason as 05/06/11 above. These three post-analysis views no longer render a fixture:
  // AgencyReportClient builds them from `result`, the live output of the scoring pipeline
  // over whatever batch you uploaded. Every value they asserted is a leftover from the
  // static seed — "84.2M", "23 flags", "BuzzBridge" and "instagram.com/p/Cx1a…" now exist
  // only in src/lib/providers/seed.ts, "Positive Signals — What's Genuine" exists nowhere
  // in the app at all, and the tab is labelled "All Posts", so 10 could not even reach its
  // assertions: its setup clicked a button named "All 500 Posts" that no longer exists.
  // There is no updated-string version of these tests, because there is no longer a fixed
  // result to assert against.
  //
  // Not re-created here with a real upload, deliberately. Driving "Analyse All Posts" runs
  // the actual scoring pipeline, and that writes permanent Agency rows to the database this
  // harness points at (the same production DATABASE_URL — playwright.config.ts mocks the
  // DATA_MODE_* providers, never the database). phase0 is a read-only screenshot walk and is
  // worth keeping that way.
  //
  // Covered instead by e2e/phase3-agency-verify.spec.ts, which already performs this exact
  // flow properly: it pastes through the real UI, runs the real analysis against the mock
  // provider, asserts all three tabs plus the evidence drill-down, and deletes its own rows
  // in an afterAll anchored to /^E2E Agency \d+$/. The sign-off screenshots these three
  // views produced are now captured there, at those same three checkpoints, so the
  // screenshot set stays complete without a second copy of a DB-writing flow.
  // 11-vijayam-detail retired in Phase 2: the fixed /campaigns/vijayam route was
  // replaced by a generic /campaigns/[id] detail view (build plan §1 explicitly
  // forbids hardcoding "vijayam" in component logic). The old mock-fixture route no
  // longer exists — this isn't a regression, it's the mandated shape change. A
  // Phase-2-specific e2e spec covers the generic detail view against real DB data
  // instead of the static seed fixture.
  // Retargeted onto furniture, like 04 and 13: /fan-pages reads fan_pages from the DB, so
  // "4.8M", "18/24", "Nivin Fanz Official" and "Verified fan" were fixture values describing
  // a tracked network no fresh database has. Labels and section headings render regardless.
  // "Suggested Fan Pages" is deliberately NOT asserted — that card is conditional on
  // suggestions.length > 0, so it would reintroduce exactly the data dependency being removed.
  {
    name: "12-fan-pages",
    path: "/fan-pages",
    text: ["Total Fan Reach", "Active Today", "Posting Campaign Tags", "Add fan page to track", "Alerts"],
    extra: async (page) => {
      // The original check here caught something real — the "All (n)" tab must count every
      // tracked page, not just the rows rendered beneath it, so "All (5)" sitting next to an
      // "18/24" KPI was self-contradictory. It asserted the fixture's literal "All (24)",
      // which is what made it die with the fixture. The invariant it was actually testing is
      // that the tab count agrees with the denominator of "Active Today" — both are rendered
      // from totalTracked — so assert the agreement rather than the number. That survives any
      // database while still failing if the two ever drift apart again.
      const activeToday = await page.locator(".kpi", { hasText: "Active Today" }).locator(".kpi-val").innerText();
      const tracked = activeToday.split("/")[1]?.trim();
      expect(tracked, `"Active Today" should render as "n/total", got "${activeToday}"`).toMatch(/^\d+$/);
      await expect(page.locator(".itab.active")).toHaveText(`All (${tracked})`);
    },
  },
  // Scoutline arrived after this suite was written and had no sign-off screenshot at
  // all. Its assertions are deliberately on static page furniture rather than batch
  // names or counts: unlike the other views this screen reads live DB rows, so
  // asserting on data would make the suite fail the moment someone runs a real scan.
  {
    name: "13-scoutline",
    path: "/scout",
    text: ["Quick Scan", "Scan Batches", "Select 2-4 batches to compare"],
  },
];

test.describe("Phase 0 — authenticated screens render seeded mock data", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([await mintSessionCookie()]);
  });

  for (const view of VIEWS) {
    test(`renders ${view.name}`, async ({ page }) => {
      await page.goto(view.path);
      if (view.setup) await view.setup(page);

      // LOAD-BEARING: with a genuine minted session we are NOT bounced to /login.
      // This is the positive proof that the app's real auth() guard accepted a real
      // token — nothing about the guard was disabled or altered.
      await expect(page).not.toHaveURL(/\/login/);

      for (const t of view.text) {
        await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
      }

      if (view.canvases !== undefined) {
        // Charts must actually mount, not render a blank box.
        await expect(page.locator("canvas")).toHaveCount(view.canvases);
      }

      if (view.extra) await view.extra(page);

      // Let Chart.js finish animating so the screenshot shows final values.
      await waitForChartsSettled(page);

      // The Next.js dev-tools badge floats over the sidebar footer and hides the
      // "NP" avatar. It exists only in dev and would misrepresent the port in a
      // sign-off screenshot, so hide it for the capture (app source untouched).
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

      await page.screenshot({ path: `e2e/screens/${view.name}.png`, fullPage: true });
    });
  }
});

test.describe("the auth guard still holds", () => {
  test("protected route redirects to /login without a session", async ({ browser }) => {
    const clean = await browser.newContext(); // deliberately no cookie
    const page = await clean.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Sign in with Google")).toBeVisible();
    await clean.close();
  });

  test("a token signed with the wrong secret is rejected", async ({ browser }) => {
    // Proves the app validates the signature rather than trusting any cookie by name.
    const clean = await browser.newContext();
    await clean.addCookies([
      {
        name: "authjs.session-token",
        value: "not-a-real-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await clean.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await clean.close();
  });
});

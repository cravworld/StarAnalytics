// OPT-IN live integration test. Does NOT run by default.
//
// Requires BOTH:
//   RUN_BOOKMYSHOW_INTEGRATION_TEST=true
//   APIFY_TOKEN=<a real token>
//
// Run with:
//   RUN_BOOKMYSHOW_INTEGRATION_TEST=true npx vitest run src/lib/bookmyshow/integration.live.test.ts
//
// It costs real money on the Apify account and sends real traffic to BookMyShow, so it is
// deliberately minimal: ONE city, ONE date, one page render. Do not widen it — a
// Kerala-wide integration test would be ~90 page loads every time someone runs the suite.
//
// This is also the test that answers the open question in BOOKMYSHOW-FEASIBILITY.md §8:
// whether BookMyShow serves these pages to a datacenter IP at all. Until it passes once,
// DATA_MODE_BOOKMYSHOW should stay on "mock".

import { describe, expect, it } from "vitest";
import { normalizeCityPage } from "./normalize";
import { ApifyBookMyShowProvider } from "./providers/apify";

const ENABLED = process.env.RUN_BOOKMYSHOW_INTEGRATION_TEST === "true" && Boolean(process.env.APIFY_TOKEN);

// `describe.skipIf` rather than an early return, so a skipped run reports as SKIPPED in the
// output instead of silently passing — a green tick that never called anything is worse
// than no test.
describe.skipIf(!ENABLED)("BookMyShow live integration (opt-in)", () => {
  // One page render through a browser actor, well inside any reasonable CI budget but far
  // above a unit test's.
  const TIMEOUT_MS = 10 * 60 * 1000;

  it(
    "renders one Kochi showtime page and returns usable demand data",
    async () => {
      const provider = new ApifyBookMyShowProvider();
      const eventCode = process.env.BOOKMYSHOW_TEST_EVENT_CODE || "et00502829";

      const items = await provider.fetchShowtimes({
        eventCode,
        movieSlug: process.env.BOOKMYSHOW_TEST_MOVIE_SLUG || "bethlehem-kudumba-unit",
        regionCodes: ["KOCH"],
        dates: [new Date()],
      });

      expect(items.length).toBe(1);
      const item = items[0];

      // The most important assertion in this file. If the page never hydrated, the actor
      // was very likely blocked or served something other than the showtime page — which
      // is the go/no-go answer, not a flaky test.
      expect(
        item.error,
        `BookMyShow page did not hydrate for a cloud actor. This is the datacenter-IP question in BOOKMYSHOW-FEASIBILITY.md §8 — treat a failure here as a finding, not a flake.`,
      ).toBeUndefined();

      const normalized = normalizeCityPage(item);

      // The region guard, live. A mismatch here means the rgn cookie is not being applied
      // early enough by preNavigationHooks.
      expect(normalized.status, `expected an ok page, got ${normalized.status}: ${normalized.error}`).toBe("ok");
      expect(normalized.returnedCityCode).toBe("KOCH");

      expect(normalized.theaters.length).toBeGreaterThan(0);
      expect(normalized.screenings.length).toBeGreaterThan(0);

      // Stable identifiers are what make repeated scans idempotent; if these stop coming
      // back, snapshot dedup silently breaks.
      for (const s of normalized.screenings.slice(0, 5)) {
        expect(s.bmsSessionId).toBeTruthy();
        expect(s.showDateTime.getTime()).toBeGreaterThan(0);
      }

      // At least some shows should carry a demand status. All-null would mean BookMyShow
      // changed or removed availStatus, which invalidates the entire feature premise.
      const withStatus = normalized.screenings.filter((s) => s.availStatus !== null);
      expect(
        withStatus.length,
        "no show carried an availStatus — BookMyShow may have changed the field this feature depends on",
      ).toBeGreaterThan(0);

      // Report what was actually observed, so a run of this test doubles as a check on
      // whether the documented status vocabulary still holds.
      const distribution = withStatus.reduce<Record<string, number>>((acc, s) => {
        acc[String(s.availStatus)] = (acc[String(s.availStatus)] ?? 0) + 1;
        return acc;
      }, {});
      console.log(
        `[bms-integration] venues=${normalized.theaters.length} shows=${normalized.screenings.length} availStatus=${JSON.stringify(distribution)} skipped=${normalized.skipped.length}`,
      );

      const unexpected = Object.keys(distribution).filter((k) => !["0", "1", "2", "3"].includes(k));
      expect(
        unexpected,
        `BookMyShow returned availStatus values this feature has never seen: ${unexpected.join(", ")}. Update demand.ts before trusting the data.`,
      ).toEqual([]);
    },
    TIMEOUT_MS,
  );
});

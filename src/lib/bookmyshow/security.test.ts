import { describe, expect, it, vi, beforeEach } from "vitest";

// Two guarantees the brief calls out explicitly, both of which are easy to regress:
//   1. No secret ever reaches an API response.
//   2. Every mutating Server Action authenticates before it does anything.

describe("no secret leaves the server", () => {
  it("keeps the Apify token out of anything the scan-status route returns", async () => {
    // The route shapes its response explicitly rather than returning the Prisma row. This
    // asserts the shape, so adding `...run` later fails here instead of silently shipping
    // apifyRunId/datasetId — identifiers for billable resources on our Apify account — to
    // a browser.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/api/theater-campaigns/[id]/scan-status/route.ts", "utf8");
    // Comments explain WHY these fields are excluded, so they legitimately name them.
    // Only the executable code is under test here.
    const code = stripComments(source);

    expect(code).not.toMatch(/\.\.\.run\b/);
    expect(code).not.toMatch(/apifyRunId|datasetId/);
    expect(code).not.toMatch(/APIFY_TOKEN/);
  });

  it("never renders an env var into the campaign UI", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const files: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) files.push(full);
      }
    })("src/components/theater");

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      // Client components are shipped to the browser verbatim. Any process.env reference
      // in one is either dead code or a leak.
      expect(source, `${file} reads process.env in a component`).not.toMatch(/process\.env/);
    }
  });

  it("logs counts and ids, never tokens or cookies", async () => {
    const { readFileSync } = await import("node:fs");
    const source = stripComments(readFileSync("src/lib/data/theaterCampaigns.ts", "utf8"));
    const logLines = source.split("\n").filter((l) => /console\.(log|warn|error)/.test(l));

    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toMatch(/token|cookie|authorization|rgn|APIFY/i);
    }
  });

  it("does not put the actor input on the error column", async () => {
    const { readFileSync } = await import("node:fs");
    const source = stripComments(readFileSync("src/lib/bookmyshow/providers/apify.ts", "utf8"));
    // Only the message is persisted — `input` carries the region cookie and run config.
    expect(source).toMatch(/err instanceof Error \? err\.message : String\(err\)/);
    expect(source).not.toMatch(/error:\s*JSON\.stringify\(input/);
  });
});

describe("campaign actions require a session", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("refuses to create a campaign for an unauthenticated caller", async () => {
    // Server Actions are POST-reachable independently of the page that renders them, so
    // this is the only thing standing between an anonymous request and a write.
    vi.doMock("@/lib/require-session", () => ({
      requireSession: vi.fn(async () => {
        throw new Error("Unauthorized");
      }),
    }));
    const createTheaterCampaign = vi.fn();
    vi.doMock("@/lib/data/theaterCampaigns", () => ({
      createTheaterCampaign,
      updateTheaterCampaign: vi.fn(),
    }));
    vi.doMock("@/lib/prisma", () => ({ prisma: { theaterCampaign: { findUnique: vi.fn(), update: vi.fn() } } }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));

    const { createTheaterCampaignAction } = await import("@/lib/actions/theaterCampaigns");

    await expect(
      createTheaterCampaignAction({
        name: "x",
        movieName: "y",
        bmsUrlOrCode: "et00502829",
        targetCityCodes: [],
        scanIntervalMinutes: 90,
        wideOpenAlertPct: 80,
        minShowsForAlert: 3,
      }),
    ).rejects.toThrow(/unauthorized/i);

    // The important half: it must not have written anything before throwing.
    expect(createTheaterCampaign).not.toHaveBeenCalled();
  });

  it("authenticates before validating, so an anonymous caller learns nothing", async () => {
    const requireSession = vi.fn(async () => {
      throw new Error("Unauthorized");
    });
    vi.doMock("@/lib/require-session", () => ({ requireSession }));
    vi.doMock("@/lib/data/theaterCampaigns", () => ({
      createTheaterCampaign: vi.fn(),
      updateTheaterCampaign: vi.fn(),
    }));
    vi.doMock("@/lib/prisma", () => ({ prisma: { theaterCampaign: { findUnique: vi.fn(), update: vi.fn() } } }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));

    const { createTheaterCampaignAction } = await import("@/lib/actions/theaterCampaigns");

    // Deliberately invalid input: an unauthenticated caller should get "Unauthorized",
    // not a helpful field-level validation report.
    await expect(createTheaterCampaignAction({})).rejects.toThrow(/unauthorized/i);
    expect(requireSession).toHaveBeenCalled();
  });

  it("guards every exported action, not just create", async () => {
    const { readFileSync } = await import("node:fs");
    const source = stripComments(readFileSync("src/lib/actions/theaterCampaigns.ts", "utf8"));

    const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);

    for (const name of exported) {
      const start = source.indexOf(`export async function ${name}`);
      const body = source.slice(start, source.indexOf("\n}", start));
      expect(body, `${name} does not call requireSession()`).toMatch(/requireSession\(\)/);
    }
  });
});

/**
 * Executable code only.
 *
 * These assertions search for names like `apifyRunId` and `process.env`, and the comments
 * in those files legitimately mention the very things they explain excluding. Matching on
 * comment text would make the guard fire on its own documentation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

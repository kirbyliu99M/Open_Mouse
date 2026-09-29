import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { guardDemoRouteFromProduction } from "../../src/app/scan/demo-guard";

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

describe("guardDemoRouteFromProduction", () => {
  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  it("calls notFound() (throws) when VERCEL_ENV is production — the demo routes (/scan/submit-demo, /scan/measured-demo, /results/demo, …) must not exist there", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => guardDemoRouteFromProduction()).toThrow();
  });

  it("does nothing outside production (preview, development, or unset)", () => {
    for (const value of ["preview", "development", undefined] as const) {
      if (value === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = value;
      expect(() => guardDemoRouteFromProduction()).not.toThrow();
    }
  });
});

// The guard only works if each demo page actually calls it, and nothing else
// notices a new demo route that forgets to (`/results/demo` was exactly that
// until it was guarded). So find the demo pages by their route and check the
// source: the segment is `demo`, ends in `-demo`, or is the paper-edge
// preview route.
describe("every demo route calls guardDemoRouteFromProduction()", () => {
  const isDemoSegment = (segment: string) =>
    segment === "demo" ||
    segment.endsWith("-demo") ||
    segment === "paper-edge-preview";

  const demoPages = (
    readdirSync("src/app", { recursive: true, encoding: "utf8" }) as string[]
  )
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith("/page.tsx"))
    .filter((path) => path.split("/").slice(0, -1).some(isDemoSegment))
    .sort();

  it("finds the known demo routes, so a rename cannot silently empty this check", () => {
    expect(demoPages).toEqual(
      expect.arrayContaining([
        "results/demo/page.tsx",
        "scan/submit-demo/page.tsx",
        "scan/measured-demo/page.tsx",
      ]),
    );
  });

  it.each(demoPages)("src/app/%s", (page) => {
    const source = readFileSync(`src/app/${page}`, "utf8");
    // A real call statement on its own line, not the name in a comment.
    expect(source).toMatch(/^\s*guardDemoRouteFromProduction\(\);/m);
  });
});

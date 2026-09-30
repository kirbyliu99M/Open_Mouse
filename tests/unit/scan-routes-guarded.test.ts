import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page under src/app/scan except the two real product screens is a dev
 * or demo route (no synthetic photo makes MediaPipe detect a hand, so these
 * exist to reach states e2e otherwise cannot). Each must call
 * `guardDemoRouteFromProduction()` so it 404s in production. A new route that
 * is meant to ship is added to the allowlist on purpose.
 * (`/results/demo` is outside this directory.)
 */
const PRODUCT_PAGES = new Set(["page.tsx", join("easy", "page.tsx")]);
const ROOT = join("src", "app", "scan");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

describe("dev and demo routes under /scan", () => {
  const demoPages = pages(ROOT).filter(
    (path) => !PRODUCT_PAGES.has(relative(ROOT, path)),
  );

  it("finds the demo routes (the scan would be vacuous otherwise)", () => {
    expect(demoPages.length).toBeGreaterThanOrEqual(8);
  });

  it.each(demoPages.map((path) => [relative(ROOT, path), path]))(
    "%s calls guardDemoRouteFromProduction",
    (_name, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/guardDemoRouteFromProduction\(\)/);
      expect(source).toMatch(/from "[./]+\/demo-guard"/);
    },
  );

  it("keeps the two product pages out of the guard's reach", () => {
    for (const page of PRODUCT_PAGES) {
      expect(readFileSync(join(ROOT, page), "utf8")).not.toMatch(
        /guardDemoRouteFromProduction/,
      );
    }
  });
});

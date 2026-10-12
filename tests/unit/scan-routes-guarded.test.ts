import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page under src/app/scan except the one real product screen,
 * `/scan/easy`, is a dev or demo route (no synthetic photo makes MediaPipe
 * detect a hand, so these exist to reach states e2e otherwise cannot) or the
 * printed-sheet photo step `/scan`, hidden in production since 2026-10-11.
 * Each must call a guard so it 404s in production: `/scan` (the printed-sheet
 * photo step) the production-only `guardDemoRouteFromProduction()`, so previews
 * can render it; every demo route the dev-only `guardDevOnlyRoute()`. A
 * new route that is meant to ship is added to the allowlist on purpose.
 * (`/results/demo` and `/sheet` are outside this directory.)
 */
const PRODUCT_PAGES = new Set([join("easy", "page.tsx")]);
const ROOT = join("src", "app", "scan");
/** The printed-sheet photo step: closed only in production. */
const PRINTED_SHEET_PAGES = new Set(["page.tsx"]);

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
    "%s calls its guard",
    (name, path) => {
      const source = readFileSync(path, "utf8");
      const guard = PRINTED_SHEET_PAGES.has(name)
        ? "guardDemoRouteFromProduction"
        : "guardDevOnlyRoute";
      const other = PRINTED_SHEET_PAGES.has(name)
        ? "guardDevOnlyRoute"
        : "guardDemoRouteFromProduction";
      expect(source).toContain(`${guard}()`);
      expect(source).not.toContain(`${other}(`);
      expect(source).toMatch(/from "[./]+\/demo-guard"/);
    },
  );

  it("keeps the product page out of the guard's reach", () => {
    for (const page of PRODUCT_PAGES) {
      expect(readFileSync(join(ROOT, page), "utf8")).not.toMatch(
        /guardDemoRouteFromProduction|guardDevOnlyRoute/,
      );
    }
  });
});

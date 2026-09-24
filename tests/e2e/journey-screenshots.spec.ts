import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const output = "docs/design/journey-2026-09-23/built";

for (const capture of [
  {
    name: "scan-light",
    path: "/scan",
    width: 390,
    height: 844,
    colorScheme: "light" as const,
  },
  {
    name: "scan-dark",
    path: "/scan",
    width: 390,
    height: 844,
    colorScheme: "dark" as const,
  },
  {
    name: "scan-measured-light",
    path: "/scan/measured-demo",
    width: 390,
    height: 844,
    colorScheme: "light" as const,
  },
  {
    name: "results-light",
    path: "/results/demo?presentation=1",
    width: 390,
    height: 844,
    colorScheme: "light" as const,
  },
  {
    name: "results-dark",
    path: "/results/demo?presentation=1",
    width: 390,
    height: 844,
    colorScheme: "dark" as const,
  },
  {
    name: "results-desktop",
    path: "/results/demo?presentation=1",
    width: 1280,
    height: 800,
    colorScheme: "light" as const,
  },
]) {
  test(`captures ${capture.name} journey view`, async ({ page }, testInfo) => {
    // Opt-in only (item 6): a normal `playwright test` run must never
    // silently rewrite the docs PNGs committed under
    // docs/design/journey-2026-09-23/built/. Run with
    // `SCREENSHOTS=1 npx playwright test tests/e2e/journey-screenshots.spec.ts`.
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    // Every capture sets its own viewport/color-scheme explicitly below, so
    // running it once (not once per configured browser project) is enough.
    test.skip(
      testInfo.project.name !== "chromium",
      "Captures once, under a single project — the viewport is explicit per capture.",
    );

    await page.setViewportSize({
      width: capture.width,
      height: capture.height,
    });
    await page.emulateMedia({
      colorScheme: capture.colorScheme,
      reducedMotion: "reduce",
    });
    await page.goto(capture.path);
    await expect(page.locator(".journey-top-bar")).toBeVisible();
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: `${output}/${capture.name}.png`,
      fullPage: true,
    });
  });
}

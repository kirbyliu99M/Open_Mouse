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
  test(`captures ${capture.name} journey view`, async ({ page }) => {
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

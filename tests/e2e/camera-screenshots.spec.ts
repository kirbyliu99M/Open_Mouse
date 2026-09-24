import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const OUTPUT = "docs/design/camera-capture-2026-09-25/built";

// Opt-in only (same convention as tests/e2e/journey-screenshots.spec.ts): a
// normal `playwright test` run must never silently rewrite the committed
// docs PNGs. Run with:
//   SCREENSHOTS=1 npx playwright test tests/e2e/camera-screenshots.spec.ts \
//     --project=chromium --project=chromium-camera --project=chromium-camera-partial

test.describe("camera capture screenshots", () => {
  test.beforeEach(async () => {
    await mkdir(OUTPUT, { recursive: true });
  });

  test("primer", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium",
      "The primer needs no fake camera — it never calls getUserMedia.",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/scan");
    await page.getByRole("button", { name: "Open camera" }).click();
    await expect(
      page.getByRole("button", { name: "Turn on camera" }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUTPUT}/primer.png`, fullPage: true });
  });

  test("viewfinder-2-of-4", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium-camera-partial",
      "Needs the fake-media project fed sheet-partial.y4m (only 2 of 4 corners).",
    );

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/scan");
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(page.locator("[data-testid='camera-cue']")).toHaveText(
      "Move back so all four paper corners are in view",
      { timeout: 15_000 },
    );
    await page.screenshot({ path: `${OUTPUT}/viewfinder-2-of-4.png` });
  });

  test("viewfinder-4-of-4-ring", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium-camera",
      "Needs the fake-media project fed sheet-full.y4m (all 4 corners).",
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/scan");
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(page.locator("[data-testid='camera-cue']")).toHaveText(
      "Perfect — hold still",
      { timeout: 15_000 },
    );
    // Auto-capture fires ~800ms after the cue turns perfect — grab the
    // frame partway through that window so the ring reads as filling
    // rather than empty or already fired.
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUTPUT}/viewfinder-4-of-4-ring.png` });
  });

  test("review", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium-camera",
      "Needs the fake-media project fed sheet-full.y4m (all 4 corners).",
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/scan");
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(
      page.getByRole("button", { name: "Use this photo" }),
    ).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${OUTPUT}/review.png` });
  });
});

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
    await page.goto("/scan/paper-edge-preview");
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
      "Needs the fake-media project fed paper-edge-partial.y4m (only 2 of 4 corners, real detector).",
    );

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/scan/paper-edge-preview");
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
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-media project fed paper-edge-full.y4m (all 4 corners, real detector).",
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/scan/paper-edge-preview");
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(page.locator("[data-testid='camera-cue']")).toHaveText(
      "Perfect — hold still",
      { timeout: 15_000 },
    );
    // Auto-capture fires ~800ms after the cue turns perfect — grab the
    // frame shortly after so the ring reads as filling rather than empty,
    // with margin against Playwright's own assertion-polling latency
    // (this static single-frame fixture has zero motion, so "perfect" can
    // be reached and start accumulating well before the assertion above
    // actually observes the text).
    await page.waitForTimeout(120);
    // If auto-capture still won the race, the shutter button (and its
    // ring) is gone — better to skip than screenshot the wrong state.
    const shutter = page.locator(".cameraShutter");
    if (await shutter.isVisible()) {
      await page.screenshot({ path: `${OUTPUT}/viewfinder-4-of-4-ring.png` });
    }
  });

  test("review", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-media project fed paper-edge-full.y4m (all 4 corners, real detector).",
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/scan/paper-edge-preview");
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(
      page.getByRole("button", { name: "Use this photo" }),
    ).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${OUTPUT}/review.png` });
  });

  test("measured-overlay (paper-edge mode)", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium",
      "A static demo route — no fake camera needed.",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    // Paper-edge mode, per Kirby: the measured card must say "paper
    // corners", never "sheet markers and the card".
    await page.goto("/scan/paper-edge-measured-demo");
    await expect(page.locator(".feedback-ok .feedbackTitle")).toContainText(
      "Hand measured",
    );
    await expect(page.locator(".feedbackCaption")).toHaveText(
      "All four paper corners were found, so the scale is checked.",
    );

    // The two dimension-line labels must not overlap each other.
    const labelBoxes = await page
      .locator(".photoOverlaySvg text")
      .evaluateAll((nodes) =>
        nodes
          .map((n) => n.getBoundingClientRect())
          .map((r) => ({
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          })),
      );
    expect(labelBoxes).toHaveLength(2);
    const [a, b] = labelBoxes;
    const overlaps =
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;
    expect(overlaps).toBe(false);

    await page.screenshot({
      path: `${OUTPUT}/measured-overlay.png`,
      fullPage: true,
    });
  });
});

import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const OUTPUT = "docs/design/easy-scan-shell-2026-09-25/built";

// Opt-in only (same convention as tests/e2e/journey-screenshots.spec.ts and
// tests/e2e/camera-screenshots.spec.ts): a normal `playwright test` run
// must never silently rewrite the committed docs PNGs. Run with:
//   SCREENSHOTS=1 npx playwright test tests/e2e/easy-scan-screenshots.spec.ts \
//     --project=chromium --project=chromium-camera-paper-edge
//
// "login-available" additionally needs real-shaped (not necessarily valid)
// Google OAuth env vars so `isAuthConfigured()` is true for that one
// request — it never actually starts an OAuth flow, just renders the
// configured button:
//   AUTH_GOOGLE_ID=x AUTH_GOOGLE_SECRET=x AUTH_SECRET=x SCREENSHOTS=1 \
//     npx playwright test tests/e2e/easy-scan-screenshots.spec.ts --project=chromium

test.describe("easy-scan shell screenshots", () => {
  test.beforeEach(async () => {
    await mkdir(OUTPUT, { recursive: true });
  });

  test("main", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(testInfo.project.name !== "chromium", "Captures once.");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Find the mouse that fits your hand.",
      }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUTPUT}/main.png`, fullPage: true });
  });

  test("login-unavailable", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(testInfo.project.name !== "chromium", "Captures once.");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Keep your scans" }),
    ).toBeVisible();
    await expect(
      page.getByText(/sign-in is unavailable right now/i),
    ).toBeVisible();
    await page.screenshot({
      path: `${OUTPUT}/login-unavailable.png`,
      fullPage: true,
    });
  });

  test("login-available", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(testInfo.project.name !== "chromium", "Captures once.");
    test.skip(
      !process.env.AUTH_GOOGLE_ID,
      "Needs AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET/AUTH_SECRET set on the dev server so isAuthConfigured() is true — see this file's header comment.",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Keep your scans" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${OUTPUT}/login-available.png`,
      fullPage: true,
    });
  });

  test("easy-scan-live", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-media project fed paper-edge-full.y4m (real detector).",
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator("[data-testid='camera-cue']")).toContainText(
      "Got it — hold still",
      { timeout: 15_000 },
    );
    // Auto-capture fires ~800ms after the cue turns "perfect" — same
    // defensive pattern as camera-screenshots.spec.ts's own ring capture:
    // if it already won the race, skip rather than screenshot the wrong
    // state.
    const shutter = page.locator(".cameraShutter");
    if (await shutter.isVisible()) {
      await page.screenshot({ path: `${OUTPUT}/easy-scan-live.png` });
    }
  });

  test("easy-scan-tip", async ({ page }, testInfo) => {
    test.skip(
      process.env.SCREENSHOTS !== "1",
      "Screenshot capture is opt-in — set SCREENSHOTS=1 to run it.",
    );
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "The dimmed background is the live camera feed — needs the fake-media project.",
    );

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/scan/easy");
    await expect(
      page.getByRole("dialog", { name: "One blank sheet is all you need" }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUTPUT}/easy-scan-tip.png` });
  });

  test("easy-scan-measured", async ({ page }, testInfo) => {
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
    await page.goto("/scan/easy/measured-demo");
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUTPUT}/easy-scan-measured.png` });
  });
});

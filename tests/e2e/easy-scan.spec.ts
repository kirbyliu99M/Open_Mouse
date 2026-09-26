import { expect, test } from "@playwright/test";
import { checkHandDetected } from "../../src/client/photo/gates";

test.describe("/scan/easy — no setup page, hand chip and first-run tip", () => {
  test("the tip and hand chip render immediately — no primer, no 'Turn on camera' click needed", async ({
    page,
  }, testInfo) => {
    // These three tests don't care about the camera at all, and a fake
    // camera project can auto-capture (and pop the gate-failure sheet)
    // mid-test — scoped to plain "chromium" (no fake-media flags) so
    // they're deterministic, same reasoning as camera-capture.spec.ts's
    // permission-denied test.
    test.skip(
      testInfo.project.name !== "mobile",
      "Camera-independent — runs once, under plain chromium.",
    );
    await page.goto("/scan/easy");

    // No setup page: there is no "Turn on camera" button anywhere on this
    // route — the camera request starts on mount.
    await expect(
      page.getByRole("button", { name: "Turn on camera" }),
    ).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: "Right hand · auto" }),
    ).toBeVisible();
  });

  test("the first-run tip shows once, dismisses, stays dismissed after reload, and reopens from '?'", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Camera-independent — runs once, under plain chromium.",
    );
    await page.goto("/scan/easy");
    const tip = page.getByRole("dialog", {
      name: "One blank sheet is all you need",
    });
    await expect(tip).toBeVisible();
    await expect(page.getByText(/a4 paper on a darker table/i)).toBeVisible();

    await page.getByRole("button", { name: "Got it" }).click();
    await expect(tip).toBeHidden();

    await page.reload();
    await expect(tip).toBeHidden();

    await page.getByRole("button", { name: "Show the first-run tip" }).click();
    await expect(tip).toBeVisible();
  });

  test("Escape dismisses the first-run tip", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Camera-independent — runs once, under plain chromium.",
    );
    await page.goto("/scan/easy");
    const tip = page.getByRole("dialog", {
      name: "One blank sheet is all you need",
    });
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });

  test("the hand chip flips on tap", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Camera-independent — runs once, under plain chromium.",
    );
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    const chip = page.getByRole("button", { name: /hand · auto/i });
    await expect(chip).toHaveText(/right hand · auto/i);
    await chip.click();
    await expect(chip).toHaveText(/left hand · auto/i);
    await chip.click();
    await expect(chip).toHaveText(/right hand · auto/i);
  });
});

test.describe("/scan/easy — live camera (real paper-edge detector)", () => {
  test("locks onto the paper, reaches a gate failure with one fix and 'Try again', retake returns to a live camera, and zero network requests fire throughout", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-media-device project (paper-edge-full.y4m).",
    );

    await page.goto("/scan/easy");
    // Let the MediaPipe warm-up fetch (started on mount) and the camera's
    // own startup settle before recording — same convention as
    // tests/e2e/scan.spec.ts and camera-capture.spec.ts's zero-network
    // checks.
    await page.waitForResponse((res) =>
      res.url().includes("/mediapipe/models/hand_landmarker.task"),
    );
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Got it" }).click();

    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("blob:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr/.test(url)) return;
      requestedUrls.push(url);
    });

    // No click was needed to get here — the live loop locks onto the paper
    // and auto-captures by itself (this fixture's lock-on is fast enough
    // that it can already have fired by the time this assertion starts
    // polling, so this only asserts the *outcome*, not an intermediate cue
    // frame). Auto-capture fires and the bottom sheet slides up over the
    // frozen photo. This fixture's scene has real paper but no real hand (a
    // flat skin-tone occluder), so the pipeline is expected to stop at the
    // hand-detection gate — reaching that exact message proves decode ->
    // detectPaperQuad -> homography all ran on the captured photo.
    const sheet = page.getByRole("dialog", { name: "Retake needed" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    const expectedMessage = checkHandDetected(0)!.message;
    await expect(sheet).toContainText(expectedMessage);

    const tryAgain = sheet.getByRole("button", { name: "Try again" });
    await expect(tryAgain).toBeVisible();
    await tryAgain.click();

    // Retake returns to a live camera: the sheet closes and the camera
    // restarts — .cameraFrame covers both the live video and (this fast
    // fixture can re-lock and auto-capture again immediately) the next
    // frozen-photo state, so this doesn't race a transient cue frame.
    await expect(sheet).toBeHidden();
    await expect(page.locator(".cameraFrame")).toBeVisible({
      timeout: 15_000,
    });

    expect(requestedUrls).toEqual([]);
  });
});

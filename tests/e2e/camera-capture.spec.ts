import { expect, test } from "@playwright/test";
import { checkHandDetected } from "../../src/client/photo/gates";

const STATUS = () => "[data-testid='scan-status']";
const CUE = () => "[data-testid='camera-cue']";

test.describe("/scan — live camera capture (docs/design/camera-capture-2026-09-25)", () => {
  test("primer -> Turn on camera -> 4/4 lock-on -> auto-capture -> review -> Use this photo reaches the pipeline, with zero network requests throughout", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera",
      "Needs the fake-media-device project (sheet-full.mjpeg).",
    );

    await page.goto("/scan/paper-edge-preview");
    // Same convention as the existing zero-network test in scan.spec.ts:
    // let the page settle (including the HandLandmarker's one-time model
    // fetch) before recording, so this only captures what the camera flow
    // itself puts on the wire.
    await page.waitForResponse((res) =>
      res.url().includes("/mediapipe/models/hand_landmarker.task"),
    );
    await page.waitForLoadState("networkidle");

    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("blob:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr/.test(url)) return;
      requestedUrls.push(url);
    });

    const openCamera = page.getByRole("button", { name: "Open camera" });
    await expect(openCamera).toBeVisible();
    await openCamera.click();

    // Primer.
    await expect(
      page.getByRole("button", { name: "Turn on camera" }),
    ).toBeVisible();
    await expect(page.getByText(/darker, plain/i)).toBeVisible();
    await page.getByRole("button", { name: "Turn on camera" }).click();

    // Live viewfinder: all 4 paper corners lock on, and the cue reaches
    // "Perfect — hold still".
    await expect(page.locator(".cameraChip").first()).toContainText(
      "Paper 4/4",
      { timeout: 15_000 },
    );
    await expect(page.locator(CUE())).toHaveText("Perfect — hold still", {
      timeout: 15_000,
    });

    // Auto-capture fires within ~800ms of continuous pass and moves to
    // review — "Use this photo" appearing is the signal.
    const usePhoto = page.getByRole("button", { name: "Use this photo" });
    await expect(usePhoto).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Retake" })).toBeVisible();

    await usePhoto.click();

    // The fake camera frame has real ArUco markers (the temporary
    // quad-source adapter's lock-on target) but no real hand, so the
    // pipeline is expected to stop at the hand-detection gate — reaching
    // that exact message proves decode -> marker detection -> homography
    // -> card detection all ran on the captured photo.
    const expectedMessage = checkHandDetected(0)!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });

    expect(requestedUrls).toEqual([]);
  });

  test("permission denied shows the calm card with an upload fallback, not error styling", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Needs a context with no fake-media flags, so getUserMedia genuinely fails.",
    );

    await page.goto("/scan/paper-edge-preview");
    const openCamera = page.getByRole("button", { name: "Open camera" });
    await expect(openCamera).toBeVisible();
    await openCamera.click();
    await page.getByRole("button", { name: "Turn on camera" }).click();

    const errorCard = page.locator(".cameraErrorCard");
    await expect(errorCard).toBeVisible({ timeout: 10_000 });
    // The calm card names why the camera is needed and how to allow it —
    // not a bare "error" — and never blocks the upload fallback.
    await expect(errorCard).toContainText(/camera/i);
    await expect(errorCard).not.toHaveClass(/feedback-error/);
    await expect(
      errorCard.getByRole("button", { name: "Upload a photo instead" }),
    ).toBeVisible();
  });
});

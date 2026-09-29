import { expect, test } from "@playwright/test";
import { checkHandDetected } from "../../src/client/photo/gates";

const STATUS = () => "[data-testid='scan-status']";
const CUE = () => "[data-testid='camera-cue']";

test.describe("/scan/paper-edge-preview — live camera capture, real paper-edge detector", () => {
  test("primer -> Turn on camera -> 4/4 lock-on via detectPaperQuad -> auto-capture -> review -> Use this photo reaches the pipeline, calibration method paper-edge, zero network requests", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-media-device project (paper-edge-full.y4m).",
    );

    await page.goto("/scan/paper-edge-preview");
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

    // Paper-edge copy: heading, "Open camera" primary action.
    await expect(
      page.getByRole("heading", {
        name: /photograph your hand on a sheet of paper/i,
      }),
    ).toBeVisible();
    const openCamera = page.getByRole("button", { name: "Open camera" });
    await expect(openCamera).toBeVisible();
    await openCamera.click();

    // Primer: paper-edge copy + paper-size toggle.
    await expect(page.getByText(/blank a4 paper/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "A4", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Turn on camera" }).click();

    // Live viewfinder: the real detector locks all 4 corners.
    const lockStart = Date.now();
    await expect(page.locator(".cameraChip").first()).toContainText(
      "Paper 4/4",
      { timeout: 15_000 },
    );
    const lockMs = Date.now() - lockStart;
    console.log(
      `paper-edge 4/4 lock-on took ${lockMs}ms (from Turn on camera)`,
    );
    await expect(page.locator(CUE())).toHaveText("Perfect — hold still", {
      timeout: 15_000,
    });

    // Auto-capture fires within ~800ms of continuous pass and moves to review.
    const usePhoto = page.getByRole("button", { name: "Use this photo" });
    await expect(usePhoto).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Retake photo" }),
    ).toBeVisible();
    await expect(page.getByText(/all four paper corners found/i)).toBeVisible();

    await usePhoto.click();

    // The fake camera frame has a real blank-paper scene (no ArUco markers,
    // no real hand — just a skin-tone occluder), so the paper-edge pipeline
    // is expected to lock the paper via detectPaperQuad and then stop at
    // the hand-detection gate — reaching that exact message proves decode
    // -> detectPaperQuad -> homography all ran on the captured photo with
    // calibration method "paper-edge".
    const expectedMessage = checkHandDetected(0)!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });

    expect(requestedUrls).toEqual([]);
  });
});

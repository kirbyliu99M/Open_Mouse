import { expect, test } from "@playwright/test";
import { buildSyntheticTopDownPhotoPng } from "./fixtures/synthetic-photo";
import { buildExifRotatedJpeg } from "./fixtures/exif-jpeg";
import { checkMarkers, checkHandDetected } from "../../src/client/photo/gates";

const FILE_INPUT = "#top-down-photo";
const STATUS = () => "[data-testid='scan-status']";

test.describe("/scan — top-down photo pipeline", () => {
  test("shows wayfinding, a way out, hand and grip pickers, and the on-device notice", async ({
    page,
  }) => {
    await page.goto("/scan");
    await expect(page.getByText("Step 1 of 3 · Top-down photo")).toBeVisible();
    await expect(page.getByRole("link", { name: /home/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Left hand" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Right hand" }),
    ).toBeVisible();
    await expect(
      page.getByText("Processed on this device — the photo is never uploaded."),
    ).toBeVisible();
  });

  test("finds all 4 markers and reaches the landmark step, then reports the exact no-hand retake message", async ({
    page,
  }) => {
    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });

    await page.setInputFiles(FILE_INPUT, {
      name: "top-down.png",
      mimeType: "image/png",
      buffer: png,
    });

    // MediaPipe genuinely cannot find a hand in a drawn oval (issue #10's
    // own premise) — assert the *specific* retake message gates.ts
    // produces for that, not just "some error happened". Reaching this
    // message is itself proof the pipeline got past marker detection,
    // correspondence matching, homography estimation and card detection
    // to reach the landmark step.
    const expectedMessage = checkHandDetected(0)!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });

    // The overlay proves markers.ts found (at least) the real 4 flat-flap
    // markers and card.ts found the card. A synthetic, hard-edged render
    // can occasionally trip js-aruco2's generous Hamming-distance matching
    // into a spurious extra "marker" from the card/hand shapes' own sharp
    // corners — harmless to the actual pipeline (buildMarkerCorrespondences
    // and checkMarkers both only look at ids 0-3), so this asserts "at
    // least", not "exactly".
    const markerCount = await page.locator(".overlayMarker").count();
    expect(markerCount).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".overlayCard")).toHaveCount(1);
  });

  test("reports the specific missing-markers message when no markers are present", async ({
    page,
  }) => {
    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: false,
    });

    await page.setInputFiles(FILE_INPUT, {
      name: "no-markers.png",
      mimeType: "image/png",
      buffer: png,
    });

    // The message is what actually matters: checkMarkers (and
    // buildMarkerCorrespondences) only look at ids 0-3, so this is
    // authoritative regardless of whether the synthetic card/hand shapes'
    // own sharp corners occasionally trip a spurious extra "candidate"
    // with some other id.
    const expectedMessage = checkMarkers([])!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });
  });

  test("makes zero network requests while processing a photo", async ({
    page,
  }) => {
    // Let the initial page load — including the HandLandmarker's one-time
    // model+WASM fetch, which src/app/scan/ScanClient.tsx deliberately
    // warms on mount — finish before recording starts, so this test
    // asserts what issue #10 actually cares about: nothing is fetched
    // while a photo is being processed, i.e. no image or derived data
    // leaves (or even reaches out from) the browser during a scan.
    await page.goto("/scan");
    // Explicit signal, not just networkidle's timing-sensitive guess: the
    // one-time model fetch has actually finished.
    await page.waitForResponse((res) =>
      res.url().includes("/mediapipe/models/hand_landmarker.task"),
    );
    await page.waitForLoadState("networkidle");

    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      // blob: is an in-memory object URL (the photo preview <img>) — no
      // bytes cross the network. __nextjs_*/webpack-hmr are `next dev`'s
      // own dev-server tooling (source maps, HMR), not application traffic
      // and not present in a production build; excluded here the same way
      // a production build wouldn't have them.
      if (url.startsWith("blob:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr/.test(url)) return;
      requestedUrls.push(url);
    });

    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });
    await page.setInputFiles(FILE_INPUT, {
      name: "top-down.png",
      mimeType: "image/png",
      buffer: png,
    });

    const expectedMessage = checkHandDetected(0)!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });

    expect(requestedUrls).toEqual([]);
  });

  test("decodes a JPEG upright per its EXIF orientation tag", async ({
    page,
  }) => {
    await page.goto("/scan");
    const exif = await buildExifRotatedJpeg(page);

    await page.setInputFiles(FILE_INPUT, {
      name: "rotated.jpg",
      mimeType: "image/jpeg",
      buffer: exif.buffer,
    });

    // No sheet in this fixture, so it always ends at "markers missing" —
    // what matters is the decoded dimensions the pipeline reports for the
    // photo it actually processed.
    await expect(page.locator(STATUS())).toContainText("hidden", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("photo-dimensions")).toHaveText(
      `${exif.displayWidth}x${exif.displayHeight}`,
    );
  });
});

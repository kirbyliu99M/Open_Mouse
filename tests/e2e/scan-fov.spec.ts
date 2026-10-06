import { expect, test, type Page } from "@playwright/test";
import {
  ATTEMPT_LOG_KEY,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";
import { buildPaperScenePng } from "./fixtures/paper-scene";

/**
 * Scan v2, frame capture (docs/design/scan-v2-2026-09-30/README.md, "Frame
 * capture"): the shutter takes a FRAME OF THE VIDEO cut to the part of the
 * stream that is on screen, the same part the live detector samples, and every
 * analysis leaves a local record shown in the debug panel.
 *
 * What cannot be tested here: what a real phone's browser answers (the S25's
 * square stream, its photo). Headless Chromium's fake camera gives whatever
 * size its video file has. These tests pin what the app ASKS for, what it
 * LOOKS at and what it KEEPS.
 */

const A4_MM = { width: 210, height: 297 };

/** A paper-edge scene in a portrait photo: the sheet fills about 80 % of the width. */
async function uploadSyntheticPhoto(
  page: Page,
  name = "scene.png",
  size: { width: number; height: number } = { width: 1500, height: 2000 },
) {
  const { width, height } = size;
  const scale = (width * 0.8) / A4_MM.width;
  const png = await buildPaperScenePng(page, {
    canvasWidth: width,
    canvasHeight: height,
    homography: [
      [scale, 0, (width - A4_MM.width * scale) / 2],
      [0, scale, (height - A4_MM.height * scale) / 2],
      [0, 0, 1],
    ],
    paperSizeMm: A4_MM,
    includeHand: true,
  });
  await page.locator("#easy-scan-upload").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: png,
  });
}

const storedAttempts = (page: Page) =>
  page.evaluate((key) => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown[];
    } catch {
      return null;
    }
  }, ATTEMPT_LOG_KEY);

test.describe("frame capture: the shutter takes the part of the video that is on screen", () => {
  test("the preview is asked for 1920x1080 again, and the camera is asked nothing about its photos: no photo capabilities, no takePhoto, no size request", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // A camera that WOULD answer photo questions slowly, so that anything
    // waiting for it would be seen; every call to it, and every constraint
    // applied to the track, is written down.
    await page.addInitScript(() => {
      const w = window as Window & {
        __gumCalls?: unknown[];
        __log?: string[];
      };
      const calls: unknown[] = (w.__gumCalls = []);
      const log: string[] = (w.__log = []);
      const media = navigator.mediaDevices;
      const original = media.getUserMedia.bind(media);
      media.getUserMedia = (constraints) => {
        calls.push(JSON.parse(JSON.stringify(constraints)));
        return original(constraints);
      };
      class StubImageCapture {
        constructor() {
          log.push("ImageCapture constructed");
        }
        async getPhotoCapabilities() {
          log.push("getPhotoCapabilities");
          await new Promise((resolve) => setTimeout(resolve, 2200));
          return { imageWidth: { max: 3840 }, imageHeight: { max: 2160 } };
        }
        async takePhoto(): Promise<Blob> {
          log.push("takePhoto");
          throw new Error("must not be used");
        }
      }
      (window as unknown as { ImageCapture: unknown }).ImageCapture =
        StubImageCapture;
      const proto = MediaStreamTrack.prototype;
      const realApply = proto.applyConstraints;
      proto.applyConstraints = function (constraints) {
        log.push(
          constraints && "advanced" in constraints
            ? "applyConstraints focus"
            : "applyConstraints size",
        );
        return realApply.call(this, constraints).catch(() => undefined);
      };
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    // The scene is perfect from the first second: the shutter fires by itself.
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      /processing|gateFailure/,
      { timeout: 30_000 },
    );
    const { calls, log } = await page.evaluate(() => ({
      calls: (window as Window & { __gumCalls?: unknown[] }).__gumCalls,
      log: (window as Window & { __log?: string[] }).__log,
    }));
    const { video } = (
      calls as { video: Record<string, unknown>; audio: boolean }[]
    )[0];
    // The request that worked on the S25 before the photo-shaped one (which
    // came back as a 1088x1088 square): the camera's landscape terms.
    expect(video).toEqual({
      facingMode: "environment",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      resizeMode: { ideal: "none" },
    });
    expect("aspectRatio" in video).toBe(false);
    // Nothing about the camera's photos was asked, and the track was never
    // asked for a size (focus only).
    expect(log).not.toContain("ImageCapture constructed");
    expect(log).not.toContain("getPhotoCapabilities");
    expect(log).not.toContain("takePhoto");
    expect(log).not.toContain("applyConstraints size");
  });

  test("the live loop and the shutter use the same part of the stream: the pipeline is handed a frame of exactly that size, uncropped, and the panel names the source", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // Hold the demo pipeline so the live panel stays where it is.
    await page.addInitScript(() => {
      const w = window as Window & {
        __easyScanLiveHold?: Promise<void>;
        __release?: () => void;
      };
      w.__easyScanLiveHold = new Promise<void>((resolve) => {
        w.__release = resolve;
      });
    });
    await page.goto("/scan/easy/live-measured-demo?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();

    // The fake camera's frame is 800x1300 (paper-edge-full.y4m); the 390x844
    // screen shows the middle 601 columns of it (390 / (844 / 1300)), x 100 to
    // 701, the whole height. The detector is given exactly that, shrunk to 640
    // on the long edge: 296x640.
    const live = page.getByTestId("debug-live-view");
    await expect(live).toContainText(
      "on screen 601×1300 of the stream at 100,0 · detector sees 296×640",
      { timeout: 15_000 },
    );
    const source = page.getByTestId("debug-capture-source");
    await expect(source).toContainText(
      "frame · stream 800×1300 · on screen 601×1300 at 100,0",
    );
    // A frame has no photo to compare the preview with: the "Preview vs photo"
    // row (always "–" for it) is not drawn at all.
    await expect(page.getByTestId("debug-fov")).toHaveCount(0);
    await expect(page.getByTestId("scan-debug-panel")).not.toContainText(
      "Preview vs photo",
    );

    // The auto-shutter fires by itself; the pipeline is held in "processing".
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    const panel = page.getByTestId("scan-debug-panel");
    await expect
      .poll(async () => (await panel.textContent()) ?? "", { timeout: 5_000 })
      .toMatch(/Capturecanvas/);
    const handed = await page.evaluate(async () => {
      const input = (
        window as Window & {
          __easyScanLiveCalls?: {
            file: File;
            previewView?: unknown;
            focalReferenceWidthPx?: number;
          }[];
        }
      ).__easyScanLiveCalls?.[0];
      if (!input) return null;
      const bitmap = await createImageBitmap(input.file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return {
        type: input.file.type,
        size,
        previewView: input.previewView ?? null,
        focalReferenceWidthPx: input.focalReferenceWidthPx ?? null,
      };
    });
    expect(handed).not.toBeNull();
    // A JPEG frame of the video, cut to the part on screen at the stream's own
    // resolution: x 100 to 700 (each edge of 99.6 and 700.4 rounded), 1300 tall.
    expect(handed!.type).toBe("image/jpeg");
    expect(handed!.size).toEqual({ width: 600, height: 1300 });
    // Within a pixel of what the live loop samples (601 wide in the panel).
    expect(Math.abs(handed!.size.width - 601)).toBeLessThanOrEqual(1);
    // The pipeline is not asked to crop anything: the frame already is the part.
    expect(handed!.previewView).toBeNull();
    // ...but is told how wide the whole stream was (800, not the frame's 600),
    // so that its assumed focal length is the live loop's for the same pixels.
    expect(handed!.focalReferenceWidthPx).toBe(800);
    await page.evaluate(() =>
      (window as Window & { __release?: () => void }).__release?.(),
    );
  });

  test("the real pipeline gets that frame: the record says frame, the sheet fills 80 % of it, and nothing is cropped or compared with a photo", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // A camera whose photo would be wrong in every way: it must never be used.
    await page.addInitScript(() => {
      class StubImageCapture {
        async getPhotoCapabilities() {
          return { imageWidth: { max: 2100 }, imageHeight: { max: 2000 } };
        }
        async takePhoto(): Promise<Blob> {
          return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
            type: "image/jpeg",
          });
        }
      }
      (window as unknown as { ImageCapture: unknown }).ImageCapture =
        StubImageCapture;
    });
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(1);
    const [attempt] = (await storedAttempts(page)) as AttemptRecord[];
    console.log(`ATTEMPT frame example: ${JSON.stringify(attempt)}`);
    expect(attempt.method).toBe("canvas");
    expect(attempt.captureSource).toBe("frame");
    // Numbers and short codes only: nothing in it is an image.
    const frameJson = JSON.stringify(attempt);
    expect(frameJson).not.toMatch(/data:|base64|blob:/i);
    expect(frameJson.length).toBeLessThan(2000);
    // The picture analysed is the on-screen part of the 800x1300 stream.
    expect(attempt.photo).toMatchObject({ width: 600, height: 1300 });
    expect(attempt.photo.kb).toBeGreaterThan(0);
    expect(attempt.analysed).toEqual({ width: 600, height: 1300, crop: null });
    // The stream, and no comparison with a photo that does not exist.
    expect(attempt.preview).toEqual({
      width: 800,
      height: 1300,
      aspectDiff: null,
      fovMismatch: null,
    });
    expect(attempt.view).toMatchObject({
      stream: { width: 800, height: 1300 },
      model: "frame",
      modelApplies: true,
      aspectDiff: 0,
    });
    expect(attempt.view!.visibleInStream!.x).toBeCloseTo(99.6, 0);
    expect(attempt.view!.visibleInStream!.width).toBeCloseTo(600.7, 0);
    expect(attempt.settleTimedOut).toBeNull();
    // The sheet, found in the frame: the fixture draws it 480 px wide in the
    // 600 px part of the stream that is on screen.
    expect(attempt.paper?.cornersSeen).toBe(4);
    expect(attempt.paper!.widthFraction).toBeGreaterThan(0.76);
    expect(attempt.paper!.widthFraction).toBeLessThan(0.84);
    // The panel's list and the copied JSON say "frame" too.
    const sheet = page.getByRole("dialog", {
      name: /Retake needed|Hand measured/,
    });
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await sheet.locator("summary", { hasText: "Debug" }).click();
    const panel = sheet.getByTestId("scan-debug-panel");
    await expect(panel.getByTestId("debug-attempts")).toContainText("frame");
    await expect(panel.getByTestId("debug-capture-source")).toContainText(
      "frame",
    );
  });

  test("a frame that cannot be made leaves the viewfinder running: the first two shutters get no blob and a throw, nothing reaches the pipeline, and the third try goes through", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // The canvas gives no blob the first time and throws the second time. At
    // each call the stage's phase is written down: "none" is the live
    // viewfinder; anything else means a result or a pipeline run has begun.
    await page.addInitScript(() => {
      const w = window as Window & {
        __toBlobCalls?: { phase: string | null; at: number }[];
      };
      const phases: { phase: string | null; at: number }[] = (w.__toBlobCalls =
        []);
      const real = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
        type?: string,
        quality?: number,
      ) {
        phases.push({
          phase:
            document.querySelector(".easyStage")?.getAttribute("data-phase") ??
            null,
          at: performance.now(),
        });
        if (phases.length === 1) {
          callback(null);
          return;
        }
        if (phases.length === 2) throw new Error("the canvas was lost");
        real.call(this, callback, type, quality);
      };
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    // The scene is perfect from the first second, so the auto-shutter fires, is
    // let down twice, and fires again after a refilled ring.
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(1);
    const calls = (await page.evaluate(
      () =>
        (
          window as Window & {
            __toBlobCalls?: { phase: string | null; at: number }[];
          }
        ).__toBlobCalls,
    ))!;
    // Exactly three frames were tried (no blob, a throw, a frame), each while
    // the viewfinder was still live: no pipeline run, no result sheet, before
    // the third. If the loop had been stopped by the first failure, or the busy
    // flag left set, there would be no third try.
    expect(calls.map((call) => call.phase)).toEqual(["none", "none", "none"]);
    // After a failure the ring starts again (800 ms of passing samples), so the
    // next try comes after a fill, not on the very next sample (125 ms).
    expect(calls[1].at - calls[0].at).toBeGreaterThan(600);
    expect(calls[2].at - calls[1].at).toBeGreaterThan(600);
    // Nothing was thrown out of the page: a throwing canvas is handled.
    expect(pageErrors).toEqual([]);
    const [attempt] = (await storedAttempts(page)) as AttemptRecord[];
    expect(attempt.method).toBe("canvas");
    expect(attempt.captureSource).toBe("frame");
    expect(attempt.photo).toMatchObject({ width: 600, height: 1300 });
    await expect(
      page.getByRole("dialog", { name: /Retake needed|Hand measured/ }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a press of the shutter before the video has a frame does nothing: no capture, the loop is not stopped, and the auto-shutter fires once the video is ready", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // A video that says it has no frame yet (readyState 1) while it plays: the
    // live loop samples nothing, and a press of the shutter has nothing to take.
    await page.addInitScript(() => {
      const w = window as Window & {
        __readyStateCap?: number | null;
        __toBlobCalls?: number;
      };
      w.__readyStateCap = 1;
      w.__toBlobCalls = 0;
      const real = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "readyState",
      )!;
      Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
        configurable: true,
        get(this: HTMLMediaElement) {
          return w.__readyStateCap ?? real.get!.call(this);
        },
      });
      const realToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
        type?: string,
        quality?: number,
      ) {
        w.__toBlobCalls = (w.__toBlobCalls ?? 0) + 1;
        realToBlob.call(this, callback, type, quality);
      };
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");
        return !!video && video.videoWidth > 0;
      },
      undefined,
      { timeout: 20_000 },
    );
    const shutter = page.getByRole("button", { name: "Take photo" });
    await shutter.click();
    await shutter.click();
    await page.waitForTimeout(1500);
    // Nothing happened: no frame was drawn, the stage is still the live view.
    expect(
      await page.evaluate(
        () => (window as Window & { __toBlobCalls?: number }).__toBlobCalls,
      ),
    ).toBe(0);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "none",
    );
    expect(await storedAttempts(page)).toEqual([]);

    // The video now has its frame: the loop, which the presses must not have
    // stopped, samples, fills the ring and takes the picture by itself.
    await page.evaluate(() => {
      (window as Window & { __readyStateCap?: number | null }).__readyStateCap =
        null;
    });
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      /processing|measured|gateFailure/,
      { timeout: 30_000 },
    );
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(1);
    expect(
      await page.evaluate(
        () => (window as Window & { __toBlobCalls?: number }).__toBlobCalls,
      ),
    ).toBe(1);
  });
});

test.describe("the attempt log", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(
      testInfo.project.name !== "mobile",
      "Uses the upload path in the phone project.",
    );
  });

  test("an uploaded photo leaves one record, shown in the debug panel, in Copy JSON, and still there after a reload", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const requests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("blob:") || url.startsWith("data:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr|_next\/static/.test(url)) return;
      requests.push(`${req.method()} ${url}`);
    });
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    expect(await storedAttempts(page)).toEqual([]);

    await uploadSyntheticPhoto(page);
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(1);

    const [attempt] = (await storedAttempts(page)) as AttemptRecord[];
    console.log(`ATTEMPT example: ${JSON.stringify(attempt)}`);
    expect(attempt.v).toBe(1);
    expect(attempt.method).toBe("upload");
    expect(attempt.captureSource).toBe("upload");
    expect(attempt.photo).toMatchObject({ width: 1500, height: 2000 });
    expect(attempt.photo.kb).toBeGreaterThan(0);
    expect(attempt.preview.width).toBeNull();
    expect(["ok", "error"]).toContain(attempt.result);
    expect(attempt.timingMs.total).toBeGreaterThan(0);
    expect(attempt.timingMs.decode).toBeGreaterThanOrEqual(0);
    // The sheet was found, so the paper numbers are there.
    expect(attempt.paper!.cornersSeen).toBe(4);
    expect(attempt.paper!.widthFraction).toBeGreaterThan(0.5);
    expect(attempt.paper!.edgeFitResidualMm).toBeGreaterThanOrEqual(0);
    expect(attempt.paper!.minSideCoverage).toBeGreaterThan(0);
    expect(attempt.sharpness).toBeGreaterThanOrEqual(0);
    expect(attempt.userAgent).toMatch(/Chrome/);
    // Numbers and short codes only: nothing in it is an image.
    const json = JSON.stringify(attempt);
    expect(json).not.toMatch(/data:|base64|blob:/i);
    expect(json.length).toBeLessThan(2000);

    // The debug panel (inside the sheet that has opened) lists it, and Copy JSON carries it.
    const sheet = page.getByRole("dialog", {
      name: /Retake needed|Hand measured/,
    });
    await expect(sheet).toBeVisible();
    await sheet.locator("summary", { hasText: "Debug" }).click();
    const panel = sheet.getByTestId("scan-debug-panel");
    await expect(panel.getByTestId("debug-attempts")).toContainText("upload");
    await expect(panel.getByTestId("debug-attempts")).toContainText(
      "1500×2000",
    );
    await panel.getByRole("button", { name: "Copy JSON" }).click();
    await expect(panel.getByRole("status")).toHaveText("Copied");
    const copied = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    expect(Array.isArray(copied.attempts)).toBe(true);
    expect(copied.attempts).toHaveLength(1);
    expect(copied.attempts[0]).toEqual(attempt);
    expect(Object.keys(copied).sort()).toEqual([
      "attempts",
      "capabilities",
      "capture",
      "focusApplied",
      "live",
      "preview",
      "track",
      "userAgent",
    ]);

    // A reload keeps it, and the panel lists it again.
    await page.reload();
    expect(await storedAttempts(page)).toHaveLength(1);
    const panelAfter = page.getByTestId("scan-debug-panel");
    await expect(panelAfter.getByTestId("debug-attempts")).toContainText(
      "upload",
      { timeout: 10_000 },
    );
    // Nothing was sent anywhere except the page's own files.
    expect(requests.filter((r) => !/127\.0\.0\.1|localhost/.test(r))).toEqual(
      [],
    );
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual([]);
  });

  test("a second attempt is added after the first, newest first in the panel", async ({
    page,
  }) => {
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    await uploadSyntheticPhoto(page);
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(1);
    await page.reload();
    await uploadSyntheticPhoto(page, "second.png");
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(2);
    const times = ((await storedAttempts(page)) as { at: string }[]).map(
      (a) => a.at,
    );
    expect(times[0] <= times[1]).toBe(true);
  });

  test("an analysis that throws is recorded with the photo it started with, not the next one's", async ({
    page,
  }) => {
    // The detector's model is held back and then fails to load, so BOTH
    // analyses below throw at the same moment, after the second photo has
    // been picked. Each record must say which photo it was.
    await page.addInitScript(() => {
      const w = window as Window & { __releaseModel?: () => void };
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      w.__releaseModel = release;
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (!url.includes("hand_landmarker.task"))
          return realFetch(input, init);
        await gate;
        throw new TypeError("offline");
      };
    });
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    await uploadSyntheticPhoto(page, "first.png", {
      width: 1500,
      height: 2000,
    });
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 30_000 },
    );
    await uploadSyntheticPhoto(page, "second.png", {
      width: 1000,
      height: 1400,
    });
    await page.evaluate(() =>
      (window as Window & { __releaseModel?: () => void }).__releaseModel?.(),
    );
    await expect
      .poll(async () => (await storedAttempts(page))?.length, {
        timeout: 60_000,
      })
      .toBe(2);
    const attempts = (await storedAttempts(page)) as AttemptRecord[];
    for (const attempt of attempts)
      expect(attempt.errors.map((e) => e.code)).toEqual([
        "DETECTOR_LOAD_FAILED",
      ]);
    // One record for each photo: not two records of the second.
    expect(
      attempts.map((a) => `${a.photo.width}x${a.photo.height}`).sort(),
    ).toEqual(["1000x1400", "1500x2000"]);
  });

  test("a page without storage still scans, and the panel shows this session's attempt", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const refuse = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", {
        get: refuse,
        configurable: true,
      });
    });
    await page.goto("/scan/easy?debug=1");
    await page
      .getByRole("button", { name: "Got it" })
      .click({ timeout: 15_000 });
    await uploadSyntheticPhoto(page);
    const sheet = page.getByRole("dialog", {
      name: /Retake needed|Hand measured/,
    });
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await sheet.locator("summary", { hasText: "Debug" }).click();
    await expect(
      sheet.getByTestId("scan-debug-panel").getByTestId("debug-attempts"),
    ).toContainText("upload", { timeout: 10_000 });
  });
});

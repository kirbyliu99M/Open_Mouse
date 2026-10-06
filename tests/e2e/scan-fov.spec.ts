import { expect, test, type Page } from "@playwright/test";
import {
  ATTEMPT_LOG_KEY,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";
import { buildPaperScenePng } from "./fixtures/paper-scene";

/**
 * Scan v2, field-of-view fix (docs/design/scan-v2-2026-09-30/README.md,
 * "Preview shape and attempt log"): the preview is asked for in the photo's
 * shape, and every analysis leaves a local record shown in the debug panel.
 *
 * What cannot be tested here: whether a real phone's browser honours the
 * requested shape. Headless Chromium's fake camera gives whatever size its
 * video file has. These tests pin what the app ASKS for and what it KEEPS.
 */

const A4_MM = { width: 210, height: 297 };

/** A paper-edge scene in a portrait photo: the sheet fills about 80 % of the width. */
async function uploadSyntheticPhoto(page: Page, name = "scene.png") {
  const width = 1500;
  const height = 2000;
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

test.describe("the camera is asked for the photo's shape", () => {
  test("getUserMedia gets an aspectRatio, 1080 across, and no 1920x1080", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    await page.addInitScript(() => {
      const media = navigator.mediaDevices;
      const original = media.getUserMedia.bind(media);
      const calls: unknown[] = [];
      (window as Window & { __gumCalls?: unknown[] }).__gumCalls = calls;
      media.getUserMedia = (constraints) => {
        calls.push(JSON.parse(JSON.stringify(constraints)));
        return original(constraints);
      };
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();

    const calls = (await page.evaluate(
      () => (window as Window & { __gumCalls?: unknown[] }).__gumCalls,
    )) as { video: Record<string, unknown>; audio: boolean }[];
    expect(calls.length).toBeGreaterThan(0);
    const { video } = calls[0];
    // 390x844 is upright: a 4:3 photo is asked for as a 3:4 stream.
    expect(video.facingMode).toBe("environment");
    expect(video.aspectRatio).toEqual({ ideal: 0.75 });
    expect(video.width).toEqual({ ideal: 1080 });
    expect(video.height).toEqual({ ideal: 1440 });
    expect(video.resizeMode).toEqual({ ideal: "none" });
    expect(calls[0].audio).toBe(false);
    // The old request, whose 16:9 answer is what cropped the preview.
    expect(JSON.stringify(video)).not.toContain("1920");
  });

  test("the live loop looks only at the part of the stream that is on screen, and a capture hands that part to the pipeline", async ({
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

    // The fake camera's frame is 1000x1300 (paper-edge-full.y4m); the 390x844
    // screen shows the middle 601 columns of it (390 / (844 / 1300)), x 200 to
    // 801, the whole height. The detector is given exactly that, shrunk to 640
    // on the long edge: 296x640. (Before, it was given the whole frame, 492x640.)
    const live = page.getByTestId("debug-live-view");
    await expect(live).toContainText(
      "on screen 601×1300 of the stream at 200,0 · detector sees 296×640",
      { timeout: 15_000 },
    );
    const row = page.getByTestId("debug-fov");
    await expect(row).toContainText("preview", { timeout: 15_000 });
    await expect(row).toContainText(/photo \d\.\d{3}/);
    await expect(row).toContainText(/asked 1080×1440 \(0\.750\)/);
    await expect(row).toContainText(/same field of view|FOV MISMATCH/);

    // The auto-shutter fires by itself; the pipeline is held in "processing".
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    const panel = page.getByTestId("scan-debug-panel");
    await expect
      .poll(async () => (await panel.textContent()) ?? "", { timeout: 5_000 })
      .toMatch(/Capture(takePhoto|canvas)/);
    const input = (await page.evaluate(
      () =>
        (
          window as Window & {
            __easyScanLiveCalls?: { previewView?: unknown }[];
          }
        ).__easyScanLiveCalls?.[0],
    )) as
      | {
          previewView?: {
            stream: { width: number; height: number };
            visibleInStream: {
              x: number;
              y: number;
              width: number;
              height: number;
            };
          };
        }
      | undefined;
    expect(input).toBeDefined();
    // For a takePhoto capture and for a canvas frame alike: both show the
    // screen's part of the stream, and the pipeline crops to it.
    expect(input!.previewView?.stream).toEqual({ width: 1000, height: 1300 });
    const visible = input!.previewView!.visibleInStream;
    expect(visible.x).toBeCloseTo(199.6, 0);
    expect(visible.y).toBe(0);
    expect(visible.width).toBeCloseTo(600.7, 0);
    expect(visible.height).toBe(1300);
    await page.evaluate(() =>
      (window as Window & { __release?: () => void }).__release?.(),
    );
  });

  test("the auto-shutter waits until the preview has been asked for the photo's shape, and focus is asked for again after the size request", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // A camera that takes 2.2 s to say its photos are 16:9 (so the preview is
    // asked again, in 16:9), supports continuous focus, and whose takePhoto
    // fails (so the capture is a canvas frame). Everything the page does is
    // written down with its time.
    await page.addInitScript(() => {
      const w = window as Window & {
        __events?: { t: number; kind: string }[];
      };
      const events: { t: number; kind: string }[] = (w.__events = []);
      const mark = (kind: string) =>
        events.push({ t: performance.now(), kind });
      class StubImageCapture {
        async getPhotoCapabilities() {
          await new Promise((resolve) => setTimeout(resolve, 2200));
          mark("capabilities");
          return { imageWidth: { max: 3840 }, imageHeight: { max: 2160 } };
        }
        async takePhoto(): Promise<Blob> {
          throw new Error("use the canvas");
        }
      }
      (window as unknown as { ImageCapture: unknown }).ImageCapture =
        StubImageCapture;
      const proto = MediaStreamTrack.prototype;
      const realApply = proto.applyConstraints;
      proto.applyConstraints = function (constraints) {
        mark(constraints && "advanced" in constraints ? "focus" : "size");
        return realApply.call(this, constraints).catch(() => undefined);
      };
      proto.getCapabilities = function () {
        return {
          focusMode: ["single-shot", "continuous"],
        } as MediaTrackCapabilities;
      };
      const realSettings = proto.getSettings;
      proto.getSettings = function () {
        return { ...realSettings.call(this), pointsOfInterest: [] };
      };
      new MutationObserver(() => {
        const stage = document.querySelector(".easyStage");
        if (
          stage?.getAttribute("data-phase") === "processing" &&
          !events.some((event) => event.kind === "processing")
        )
          mark("processing");
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-phase"],
      });
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 30_000 },
    );
    const events = (await page.evaluate(
      () =>
        (window as Window & { __events?: { t: number; kind: string }[] })
          .__events,
    )) as { t: number; kind: string }[];
    const at = (kind: string) => events.filter((e) => e.kind === kind);
    const capabilities = at("capabilities")[0];
    const processing = at("processing")[0];
    expect(capabilities).toBeDefined();
    expect(processing).toBeDefined();
    // The shutter did not fire while the preview was still being set up: the
    // scene is perfect from the first second and the ring needs 0.8 s, so
    // without the wait the photo would be taken at about 1.2 s, not after 2.2 s.
    expect(processing.t).toBeGreaterThan(capabilities.t);
    // The track was asked for a size, once (16:9 is not 4:3; no swapped retry
    // on top of that)...
    const sizes = at("size");
    expect(sizes).toHaveLength(1);
    expect(sizes[0].t).toBeGreaterThan(capabilities.t);
    // ...and then asked for continuous focus again, after it.
    const focus = at("focus");
    expect(focus.length).toBeGreaterThanOrEqual(2);
    expect(focus[focus.length - 1].t).toBeGreaterThan(sizes[0].t);
    expect(focus[0].t).toBeLessThan(capabilities.t);
  });
});

test.describe("a photo that shows more than its preview did", () => {
  test("is cropped to the part that was on screen inside the pipeline, and the paper is found in the crop", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
    // The fake camera's preview is 1000x1300 (paper-edge-full.y4m) and the 390x844
    // screen shows its middle 601 columns. takePhoto is replaced by a still that
    // is 2000x2100: much less elongated than the preview, so it shows more
    // across (the preview is the middle 1615 of its 2000 columns). The part on
    // screen is therefore the middle 970 columns of the still, 515 in from each
    // side; the sheet is drawn 85 % as wide as THAT (824 px), and the sides are desk.
    await page.addInitScript(() => {
      class StubImageCapture {
        async getPhotoCapabilities() {
          return { imageWidth: { max: 1300 }, imageHeight: { max: 1000 } };
        }
        async takePhoto() {
          const canvas = document.createElement("canvas");
          canvas.width = 2000;
          canvas.height = 2100;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#3a3a3d";
          ctx.fillRect(0, 0, 2000, 2100);
          ctx.fillStyle = "#f6f6f2";
          const w = 824;
          const h = Math.round((w * 297) / 210);
          ctx.fillRect((2000 - w) / 2, (2100 - h) / 2, w, h);
          return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error("no blob"))),
              "image/jpeg",
              0.92,
            ),
          );
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
    expect(attempt.method).toBe("takePhoto");
    expect(attempt.photo).toMatchObject({ width: 2000, height: 2100 });
    expect(attempt.preview).toMatchObject({ width: 1000, height: 1300 });
    // The photo is much less elongated than the preview: a field-of-view mismatch...
    expect(attempt.preview.fovMismatch).toBe(true);
    expect(attempt.preview.aspectDiff).toBeGreaterThan(0.2);
    // ...so the screen's part of the stream is carried over through the
    // "the stream is a centred part of the photo" model, which holds here.
    expect(attempt.view).toMatchObject({
      stream: { width: 1000, height: 1300 },
      model: "stream-in-still",
      modelApplies: true,
    });
    expect(attempt.view!.visibleInStream!.width).toBeCloseTo(600.7, 0);
    expect(attempt.analysed.crop).toEqual({
      x: 515,
      y: 0,
      width: 970,
      height: 2100,
    });
    expect(attempt.analysed).toMatchObject({ width: 970, height: 2100 });
    // The sheet was found in the crop, where it is 85 % of the width (it is
    // 41 % of the whole photo's).
    expect(attempt.paper?.cornersSeen).toBe(4);
    expect(attempt.paper!.widthFraction).toBeGreaterThan(0.82);
    expect(attempt.paper!.widthFraction).toBeLessThan(0.88);
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

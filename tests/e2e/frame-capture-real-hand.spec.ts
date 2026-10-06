import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  chromium,
  devices,
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import {
  ATTEMPT_LOG_KEY,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";

/**
 * Measurement, not a test of the suite: does a FRAME OF THE VIDEO, cut to the
 * part that was on screen, get through the real pipeline with a real hand?
 * (docs/design/scan-v2-2026-09-30/README.md, "Frame capture".) The fake camera
 * is fed one of Kirby's own hand photos as its video, framed the way the
 * guide asks (the sheet at 85 % of the screen's width), and the whole easy scan
 * runs for real on a production build: the live detector, the auto-shutter, the
 * canvas frame, the real MediaPipe hand detector and every gate.
 *
 * It proves "the cropped image passes the gates", which the S25 could not do
 * with its photo. It does not prove anything about the S25's own camera.
 *
 *   npx next build && npx next start -p 3230          (in another terminal)
 *   FRAME_HAND=1 FRAME_HAND_PHOTO="<path to a hand photo on a sheet>" \
 *     PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_PORT=3230 \
 *     npx playwright test tests/e2e/frame-capture-real-hand.spec.ts --project=chromium
 *
 * The photo is never committed and never leaves this machine; needs ffmpeg on
 * PATH. The test opens its own browser: the fake video is a launch flag.
 */
const run = promisify(execFile);

/** The stream the fake camera gives: 1080x1920, what the S25 gave for a 1920x1080 request. */
const STREAM = { width: 1080, height: 1920 };
/** A screen with the S25's shape (412x772 CSS px: the stream's visible part is x 27.7, width 1024.6 of 1080). */
const SCREEN = { width: 412, height: 772 };
/** The sheet's width as a share of the part on screen: where the guide rectangle puts it. */
const SHEET_SHARE = 0.85;

async function composeFrame(
  browser: Browser,
  photo: Buffer,
): Promise<{ png: Buffer; visibleWidth: number }> {
  const page = await browser.newPage();
  try {
    await page.goto("about:blank");
    const visibleWidth = (SCREEN.width * STREAM.height) / SCREEN.height;
    const base64 = await page.evaluate(
      async ({ b64, stream, sheetWidth }) => {
        const blob = new Blob(
          [Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))],
          { type: "image/jpeg" },
        );
        const bitmap = await createImageBitmap(blob, {
          imageOrientation: "from-image",
        });
        const canvas = document.createElement("canvas");
        canvas.width = stream.width;
        canvas.height = stream.height;
        const ctx = canvas.getContext("2d")!;
        // The desk colour of the photo, sampled in its bottom-left corner.
        const probe = document.createElement("canvas");
        probe.width = probe.height = 1;
        const pctx = probe.getContext("2d")!;
        pctx.drawImage(bitmap, 0, bitmap.height - 40, 30, 30, 0, 0, 1, 1);
        const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, stream.width, stream.height);
        // In this photo the sheet is about as wide as the photo: draw the photo
        // so that the sheet is `sheetWidth` wide, centred.
        const fit = sheetWidth / bitmap.width;
        const w = bitmap.width * fit;
        const h = bitmap.height * fit;
        ctx.drawImage(
          bitmap,
          (stream.width - w) / 2,
          (stream.height - h) / 2,
          w,
          h,
        );
        return canvas.toDataURL("image/png").split(",")[1];
      },
      {
        b64: photo.toString("base64"),
        stream: STREAM,
        sheetWidth: visibleWidth * SHEET_SHARE,
      },
    );
    return { png: Buffer.from(base64, "base64"), visibleWidth };
  } finally {
    await page.close();
  }
}

const storedAttempts = (page: Page) =>
  page.evaluate((key) => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown[];
    } catch {
      return null;
    }
  }, ATTEMPT_LOG_KEY);

test("a frame of the video cut to the part on screen goes through the real pipeline with a real hand", async ({
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.FRAME_HAND !== "1" || !process.env.FRAME_HAND_PHOTO,
    "A measurement, run by hand: set FRAME_HAND=1 and FRAME_HAND_PHOTO.",
  );
  test.skip(testInfo.project.name !== "chromium", "Opens its own browser.");
  test.setTimeout(240_000);

  const photo = await readFile(process.env.FRAME_HAND_PHOTO!);
  const dir = await mkdtemp(path.join(os.tmpdir(), "frame-hand-"));
  try {
    // 1. The video: the photo, framed at the guide, as one y4m frame.
    const composer = await chromium.launch();
    let png: Buffer;
    let visibleWidth: number;
    try {
      ({ png, visibleWidth } = await composeFrame(composer, photo));
    } finally {
      await composer.close();
    }
    await writeFile(path.join(dir, "frame.png"), png);
    await run("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-i",
      path.join(dir, "frame.png"),
      "-frames:v",
      "1",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "frame.y4m"),
    ]);

    // 2. The whole easy scan, on a phone-shaped screen, with that video as its camera.
    const browser = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${path.join(dir, "frame.y4m")}`,
      ],
    });
    try {
      const context = await browser.newContext({
        ...devices["Pixel 7"],
        viewport: SCREEN,
        permissions: ["camera"],
        baseURL,
      });
      const page = await context.newPage();
      await page.goto("/scan/easy?debug=1");
      await page.getByRole("button", { name: "Got it" }).click();
      const sheet = page.getByRole("dialog", {
        name: /Hand measured|Retake needed/,
      });
      await expect(sheet).toBeVisible({ timeout: 90_000 });
      await expect
        .poll(async () => (await storedAttempts(page))?.length, {
          timeout: 30_000,
        })
        .toBe(1);
      const [attempt] = (await storedAttempts(page)) as AttemptRecord[];
      console.log(
        `FRAME HAND record: ${JSON.stringify(attempt)}\nvisible width of the stream: ${visibleWidth.toFixed(1)} of ${STREAM.width}`,
      );
      const title = await sheet.getAttribute("aria-label");
      console.log(`FRAME HAND sheet: ${title}`);

      // What was analysed is a frame of the video, cut to the part on screen.
      expect(attempt.method).toBe("canvas");
      expect(attempt.captureSource).toBe("frame");
      expect(attempt.photo.height).toBe(STREAM.height);
      expect(Math.abs(attempt.photo.width! - visibleWidth)).toBeLessThanOrEqual(
        1,
      );
      expect(attempt.analysed.crop).toBeNull();
      // The sheet is where the guide puts it, in the frame.
      expect(attempt.paper?.cornersSeen).toBe(4);
      expect(attempt.paper!.widthFraction).toBeGreaterThan(SHEET_SHARE - 0.06);
      expect(attempt.paper!.widthFraction).toBeLessThan(SHEET_SHARE + 0.06);
      // The frame passes the gates with the hand found, and is measured.
      expect(attempt.errors, JSON.stringify(attempt.errors)).toEqual([]);
      expect(attempt.result).toBe("ok");
      expect(attempt.hand.detected).toBe(true);
      // A canvas frame has no EXIF focal length: the parallax correction is not
      // run for a view straight above the sheet (and says so).
      expect(attempt.parallaxCorrected).toBe(false);
      await expect(sheet).toHaveAccessibleName("Hand measured");
      const numbers = await sheet.innerText();
      console.log(`FRAME HAND measured sheet text:\n${numbers}`);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

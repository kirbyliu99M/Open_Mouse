import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { buildDemoPhotoUrl } from "../../src/app/scan/demo-photo";

const OUTPUT = "docs/design/scan-v2-2026-09-30/built";

// Opt-in only (same convention as tests/e2e/easy-scan-screenshots.spec.ts): a
// normal `playwright test` run must never silently rewrite the committed docs
// PNGs. Run with:
//   SCREENSHOTS=1 npx playwright test tests/e2e/easy-scan-v2-screenshots.spec.ts \
//     --project=chromium-camera-paper-edge
//
// The seven screens of docs/design/scan-v2-2026-09-30/screens/, captured with
// REAL motion (no reduced-motion emulation), each at the moment it is meant to
// show: the pulse ring while a corner pops in, the reticle after a tap, the
// ring part-way round, the scan line part-way down.
//
// The camera is a canvas stream (1080x1920, like a phone held upright) drawing
// a dark table with the demo paper and hand laid on it where the guide
// rectangle frames an A4 sheet, so the states below can be reached on
// purpose: an empty table, a paper half out of frame, a blurred picture, a
// sharp one. Nothing else is faked: the live loop, the paper detector, the
// pipeline (except where a screen says otherwise) and every animation are the
// app's own.

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    process.env.SCREENSHOTS !== "1",
    "Screenshot capture is opt-in: set SCREENSHOTS=1 to run it.",
  );
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-media project.",
  );
  await mkdir(OUTPUT, { recursive: true });
});

type Scene = "empty" | "partial" | "blur" | "sharp";

async function installCamera(
  page: Page,
  options: { scene: Scene; focusSupported: boolean },
) {
  await page.addInitScript(
    ({ sceneUrl, scene, focusSupported }) => {
      const W = 1080;
      const H = 1920;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const picture = new Image();
      picture.src = sceneUrl;
      const w = window as Window & { __scene?: string; __dy?: number };
      w.__scene = scene;
      w.__dy = 0.26;
      // Where the demo paper sits (LiveMeasuredDemoClient's PAPER fractions).
      const paper = { x: 0.151 * W, y: 0.198 * H, w: 0.698 * W, h: 0.556 * H };
      // The scene is painted once per change into a second canvas (a blur of
      // 1080x1920 is far too heavy to redo 30 times a second on the page's own
      // thread); the stream canvas just copies it.
      const scenery = document.createElement("canvas");
      scenery.width = W;
      scenery.height = H;
      const sctx = scenery.getContext("2d")!;
      let painted = "";
      function paint() {
        const current = w.__scene;
        const key = `${current}|${w.__dy}|${picture.complete}`;
        if (key === painted) return;
        painted = key;
        sctx.filter = current === "blur" ? "blur(14px)" : "none";
        const table = sctx.createLinearGradient(0, 0, W, H);
        table.addColorStop(0, "#43301f");
        table.addColorStop(1, "#2b1e14");
        sctx.fillStyle = table;
        sctx.fillRect(-40, -40, W + 80, H + 80);
        sctx.strokeStyle = "rgba(20,12,6,0.35)";
        sctx.lineWidth = 3;
        for (let y = 60; y < H; y += 90) {
          sctx.beginPath();
          sctx.moveTo(0, y);
          sctx.bezierCurveTo(W * 0.3, y - 14, W * 0.7, y + 14, W, y);
          sctx.stroke();
        }
        if (current !== "empty" && picture.complete) {
          const dy = current === "partial" ? (w.__dy ?? 0.26) * H : 0;
          sctx.drawImage(picture, paper.x, paper.y + dy, paper.w, paper.h);
        }
        sctx.filter = "none";
      }
      function draw() {
        paint();
        ctx.drawImage(scenery, 0, 0);
      }
      draw();
      setInterval(draw, 66);
      navigator.mediaDevices.getUserMedia = async () =>
        canvas.captureStream(30);
      if (focusSupported) {
        const proto = MediaStreamTrack.prototype;
        const realApply = proto.applyConstraints;
        proto.applyConstraints = function (constraints) {
          return realApply.call(this, constraints).catch(() => undefined);
        };
        proto.getCapabilities = function () {
          return {
            focusMode: ["manual", "single-shot", "continuous"],
          } as MediaTrackCapabilities;
        };
        const realSettings = proto.getSettings;
        proto.getSettings = function () {
          return { ...realSettings.call(this), pointsOfInterest: [] };
        };
      }
    },
    {
      sceneUrl: buildDemoPhotoUrl("paper"),
      scene: options.scene,
      focusSupported: options.focusSupported,
    },
  );
}

async function start(page: Page, url = "/scan/easy") {
  await page.goto(url);
  // The typed-length entry is off in production (src/lib/flags.ts) and on in
  // the test server; hide its link so the picture is what production shows.
  await page.addStyleTag({ content: ".easyNoPaperRow { display: none; }" });
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
}

const cue = (page: Page) => page.getByTestId("camera-cue");
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUTPUT}/${name}.png` });

test.describe("scan v2 storyboard, built (real motion)", () => {
  test("01 searching for the paper", async ({ page }) => {
    await installCamera(page, { scene: "empty", focusSupported: true });
    await start(page);
    await expect(cue(page)).toHaveText("Point the camera at the paper");
    await page.waitForTimeout(500);
    await shot(page, "01-searching");
  });

  test("02 locking corners, two of four", async ({ page }) => {
    await installCamera(page, { scene: "partial", focusSupported: true });
    await start(page);
    await expect(cue(page)).toHaveText(
      "Move back so all four paper corners are in view",
      { timeout: 20_000 },
    );
    await expect(page.locator(".easyCorner[data-found=true]")).toHaveCount(2, {
      timeout: 20_000,
    });
    // A moment after the second dot pops in: its pulse ring is still going.
    await page.waitForTimeout(140);
    await shot(page, "02-locking");
  });

  test("03 focus needed, after a tap", async ({ page }) => {
    await installCamera(page, { scene: "blur", focusSupported: true });
    await start(page);
    await expect(cue(page)).toHaveText("Tap the paper to focus", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("easy-hint")).toHaveText(
      "Waiting for a sharp picture",
    );
    await page
      .locator(".easyStage")
      .click({ position: { x: 195, y: 410 }, force: true });
    await expect(page.getByTestId("focus-reticle")).toBeVisible();
    await page.waitForTimeout(200);
    await shot(page, "03-focus-needed");
  });

  test("04 ready, the ring filling", async ({ page }) => {
    await installCamera(page, { scene: "sharp", focusSupported: true });
    await start(page);
    const circumference = 2 * Math.PI * 40;
    // Part-way round: the ring takes 800 ms of passing samples.
    await expect
      .poll(
        async () => {
          const offset = await page
            .locator(".cameraShutterRing circle")
            .first()
            .getAttribute("stroke-dashoffset")
            .catch(() => null);
          if (offset === null) return 1;
          return 1 - Number(offset) / circumference;
        },
        { timeout: 20_000, intervals: [30] },
      )
      .toBeGreaterThan(0.4);
    await shot(page, "04-ready");
  });

  test("05 freeze and measure, the scan line on its way down", async ({
    page,
  }) => {
    await installCamera(page, { scene: "sharp", focusSupported: true });
    await page.addInitScript(() => {
      const w = window as Window & {
        __easyScanLiveHold?: Promise<void>;
        __release?: () => void;
      };
      w.__easyScanLiveHold = new Promise<void>((resolve) => {
        w.__release = resolve;
      });
    });
    await start(page, "/scan/easy/live-measured-demo");
    await expect(page.locator(".easyScanLine")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(240);
    await shot(page, "05-freeze-and-measure");

    // 06: the same run, released.
    await page.evaluate(() =>
      (window as Window & { __release?: () => void }).__release?.(),
    );
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1800); // the spring settles, both lines are drawn
    await shot(page, "06-measured");
  });

  test("07 retake needed: a problem the pipeline located is outlined in amber", async ({
    page,
  }) => {
    await installCamera(page, { scene: "sharp", focusSupported: true });
    await start(page, "/scan/easy/live-measured-demo?result=retake");
    await expect(
      page.getByRole("dialog", { name: "Retake needed" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator(".easyProblem")).toHaveCount(1);
    await shot(page, "07-retake-needed");
  });

  test("07b retake needed: no hand found, nothing outlined (the real pipeline)", async ({
    page,
  }) => {
    await installCamera(page, { scene: "sharp", focusSupported: true });
    await start(page);
    await expect(
      page.getByRole("dialog", { name: "Retake needed" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot(page, "07b-retake-no-hand-found");
  });
});

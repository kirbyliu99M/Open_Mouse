import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";
import {
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

// SCREENSHOT_DIR points a run somewhere else (the WebGL stage's shots live in
// docs/design/home-v3-2026-10-03/gl), so the pr-b originals stay as they were.
const OUTPUT =
  process.env.SCREENSHOT_DIR ?? "docs/design/home-v3-2026-10-03/pr-b";
const SHORT_OUTPUT = "docs/design/home-v3-2026-10-03/short-desktop";

// Opt-in only (the same convention as easy-scan-screenshots.spec.ts): a normal
// `playwright test` run must never rewrite the committed docs PNGs. Run with:
//   SCREENSHOTS=1 npx playwright test tests/e2e/home-stage-screenshots.spec.ts \
//     --project=chromium
// One shot of the viewport (not the whole page: the stage is a pinned panel)
// for each key progress p, at 375x667, 390x844 and 1440x900.

const SIZES = [
  [375, 667],
  [390, 844],
  [1440, 900],
] as const;
const PROGRESS = [0, 0.3, 0.5, 0.72, 0.8, 0.9, 0.95, 1] as const;

// Short laptop windows (the hero scales down with the height): p = 0 and about
// the middle of the story, with the nav showing at p = 0 as a visitor first
// sees it. `... --project=chromium -g "short desktop"` captures only these.
const SHORT_SIZES = [
  [1280, 640],
  [1366, 657],
] as const;
const SHORT_PROGRESS = [0, 0.5] as const;

test.describe("home stage screenshots", () => {
  /** The stage at rest at each progress, one viewport shot each, into `output`. */
  async function capture(
    page: import("@playwright/test").Page,
    width: number,
    height: number,
    progress: readonly number[],
    output: string,
  ) {
    await recordStage(page);
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await waitForAnimated(page);
    // The shimmer is over (it is the one thing that moves on its own), so
    // every shot is the stage at rest.
    const activatedAt = await read<number>(page, "__activatedAt");
    await page.waitForFunction(
      (start) => performance.now() - start > 3400,
      activatedAt,
    );
    for (const p of progress) {
      if (p === 0) {
        // The first screen, with the nav, as a visitor first sees it.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
      } else {
        await scrollToProgress(page, p);
        await page.waitForTimeout(200);
      }
      await page.screenshot({
        path: `${output}/${width}x${height}-p${p.toFixed(2)}.png`,
      });
    }
  }

  test.skip(
    process.env.SCREENSHOTS !== "1",
    "Screenshot capture is opt-in: set SCREENSHOTS=1 to run it.",
  );
  test.beforeEach(async () => {
    await mkdir(OUTPUT, { recursive: true });
  });

  for (const [width, height] of SIZES) {
    test(`${width}x${height}`, async ({ page }, info) => {
      test.skip(info.project.name !== "chromium", "Captures once.");
      test.setTimeout(120_000);
      await capture(page, width, height, PROGRESS, OUTPUT);
    });
  }

  // The finale's two fallbacks at p = 1 (the review of 2026-10-11): its
  // headline as DOM text when its canvas layer can not be built, and under
  // forced colours. `-g "finale fallback"` captures only these.
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    for (const mode of ["layer-off", "forced-colors"] as const) {
      test(`finale fallback ${mode} ${width}x${height}`, async ({
        page,
      }, info) => {
        test.skip(info.project.name !== "chromium", "Captures once.");
        if (mode === "layer-off") {
          await page.addInitScript(() => {
            const fail = () => {
              throw new Error("no pixels (screenshot)");
            };
            const offscreen = (
              globalThis as unknown as {
                OffscreenCanvasRenderingContext2D?: { prototype: object };
              }
            ).OffscreenCanvasRenderingContext2D;
            if (offscreen) {
              (
                offscreen.prototype as { getImageData: () => never }
              ).getImageData = fail;
            }
          });
        } else {
          await page.emulateMedia({ forcedColors: "active" });
        }
        await recordStage(page);
        await page.setViewportSize({ width, height });
        await page.goto("/");
        await waitForAnimated(page);
        await scrollToProgress(page, 1);
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${OUTPUT}/${width}x${height}-p1.00-${mode}.png`,
        });
      });
    }
  }

  for (const [width, height] of SHORT_SIZES) {
    test(`short desktop ${width}x${height}`, async ({ page }, info) => {
      test.skip(info.project.name !== "chromium", "Captures once.");
      test.setTimeout(120_000);
      await mkdir(SHORT_OUTPUT, { recursive: true });
      await capture(page, width, height, SHORT_PROGRESS, SHORT_OUTPUT);
    });
  }
});

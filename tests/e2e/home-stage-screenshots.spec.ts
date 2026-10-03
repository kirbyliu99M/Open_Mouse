import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";
import {
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

const OUTPUT = "docs/design/home-v3-2026-10-03/pr-b";

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
const PROGRESS = [0, 0.3, 0.5, 0.95] as const;

test.describe("home stage screenshots", () => {
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
      for (const p of PROGRESS) {
        if (p === 0) {
          // The first screen, with the nav, as a visitor first sees it.
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(200);
        } else {
          await scrollToProgress(page, p);
          await page.waitForTimeout(200);
        }
        await page.screenshot({
          path: `${OUTPUT}/${width}x${height}-p${p.toFixed(2)}.png`,
        });
      }
    });
  }
});

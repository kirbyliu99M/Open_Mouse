import { expect, test, type Page } from "@playwright/test";

/**
 * Kirby 2026-10-26 (candidate / 未拍板): the landing page warms the hand
 * detector's 7.8 MB model once it is idle, and a press on the scan button the
 * runtime (src/client/photo/preloadDetector.ts); nothing with Save-Data on. Run alone through
 * the safe runner: `--project=chromium --workers=1`.
 */
const MODEL = "/mediapipe/models/hand_landmarker.task";
const RUNTIME = [
  "/mediapipe/wasm/vision_wasm_internal.js",
  "/mediapipe/wasm/vision_wasm_internal.wasm",
];

function recordRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/mediapipe/")) seen.push(path);
  });
  return seen;
}

test("the landing page downloads only the model once it is idle", async ({
  page,
}) => {
  const seen = recordRequests(page);
  await page.goto("/");
  await expect.poll(() => seen, { timeout: 20_000 }).toEqual([MODEL]);
  await page.waitForTimeout(2_000);
  expect(seen).toEqual([MODEL]);
});

test("a press on the scan button starts the runtime too", async ({ page }) => {
  const seen = recordRequests(page);
  await page.goto("/");
  await expect.poll(() => seen, { timeout: 20_000 }).toEqual([MODEL]);
  // The press, not the navigation: stay on the page to see what it started.
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>("a.home-cta")!;
    link.addEventListener("click", (event) => event.preventDefault());
  });
  await page.locator("a.home-cta").first().click();
  await expect
    .poll(() => seen.filter((path) => RUNTIME.includes(path)), {
      timeout: 20_000,
    })
    .toEqual(RUNTIME);
});

test("with Save-Data on it downloads nothing", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true, effectiveType: "4g" },
    });
  });
  const seen = recordRequests(page);
  await page.goto("/");
  await page.waitForTimeout(6_000);
  expect(seen).toEqual([]);
});

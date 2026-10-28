import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Click the big photo to enlarge it (candidate, 2026-10-11): open, zoom by
 * keyboard, Esc, focus return, the body scroll lock, the scrim, and a pinch
 * through two touch points. The fit and analysis routes are stubbed (no
 * database in e2e) and the top mouse is given its real committed photo, so the
 * 480 px and 960 px files both exist.
 *
 * NOT RUN by its author: Playwright crashes the machine this was written on
 * (Kirby's rule for this task). It has only been type-checked and linted.
 */

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/many-results.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as {
  scanId: string;
  results: { mouse: { slug: string; imageUrl?: string | null } }[];
};

const SCAN_ID = FIXTURE.scanId;
const TOP = FIXTURE.results[0].mouse.slug; // logitech-g-pro-x-superlight-2
// Every mouse gets a photo path, so the small cards have an <img> too (some of
// those files do not exist: only the DOM matters for the cards).
const WITH_PHOTO = {
  ...FIXTURE,
  results: FIXTURE.results.map((r) => ({
    ...r,
    mouse: { ...r.mouse, imageUrl: `/images/mice/${r.mouse.slug}.webp` },
  })),
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubScan(page: Page) {
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    fulfillJson(route, 200, WITH_PHOTO),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    fulfillJson(route, 404, { error: "no analysis in this test" }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    fulfillJson(route, 404, { error: "Scan not found." }),
  );
}

/** The scale of the photo in the dialog, from its CSS transform. */
async function scaleOf(page: Page): Promise<number> {
  return page.locator(".results-photoDialog-img").evaluate((img) => {
    const m = /scale\(([\d.]+)\)/.exec((img as HTMLElement).style.transform);
    return m ? Number(m[1]) : 1;
  });
}

test.describe("click the big photo to enlarge it", () => {
  test.beforeEach(async ({ page }) => {
    await stubScan(page);
    await page.goto(`/results/${SCAN_ID}`);
  });

  test("opens a modal dialog, zooms by keyboard, and closes with Esc", async ({
    page,
  }) => {
    const open = page.locator(".results-photoZoom-btn");
    await expect(open).toHaveCount(1);
    await expect(open).toHaveAttribute("aria-haspopup", "dialog");
    await expect(open).toHaveAccessibleName(/放大照片|Enlarge photo/);

    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog.results-photoDialog");
    // The dialog must be up, and stay up (it once closed itself under React
    // StrictMode in dev), before any key is pressed.
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty("open", true);
    await page.waitForTimeout(300);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/Logitech|G PRO X/i);

    // The page behind does not scroll.
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

    // The big file is swapped in once it has loaded.
    await expect(page.locator(".results-photoDialog-img")).toHaveAttribute(
      "src",
      `/images/mice/l/${TOP}.webp`,
    );

    // Keyboard zoom: + zooms in, + again more, - goes back down (from a real
    // zoom, so it cannot pass at 1x), 0 resets.
    expect(await scaleOf(page)).toBe(1);
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.5);
    const high = await scaleOf(page);
    await page.keyboard.press("-");
    await expect.poll(() => scaleOf(page)).toBeLessThan(high);
    expect(await scaleOf(page)).toBeGreaterThan(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("0");
    await expect.poll(() => scaleOf(page)).toBe(1);

    // Esc closes, focus is back on the button, and the page scrolls again.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  });

  test("the keys keep working after a mouse click on the photo", async ({
    page,
  }) => {
    await page.locator(".results-photoZoom-btn").click();
    await expect(page.locator("dialog.results-photoDialog")).toBeVisible();
    await page.locator(".results-photoDialog-area").click();
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
    await page.keyboard.press("0");
    await expect.poll(() => scaleOf(page)).toBe(1);
  });

  test("closes by the close button and by a click on the scrim, and reopens at 1x", async ({
    page,
  }) => {
    const open = page.locator(".results-photoZoom-btn");
    const dialog = page.locator("dialog.results-photoDialog");

    await open.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
    await dialog.getByRole("button", { name: /關閉|Close/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

    // Zoom is reset on close.
    await open.click();
    await expect(dialog).toBeVisible();
    expect(await scaleOf(page)).toBe(1);

    // A click on the scrim (the dialog itself, outside the photo) closes it.
    await page.mouse.click(4, 4);
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("double click toggles 2.5x and the wheel zooms", async ({ page }) => {
    await page.locator(".results-photoZoom-btn").click();
    await expect(page.locator("dialog.results-photoDialog")).toBeVisible();
    const area = page.locator(".results-photoDialog-area");
    await area.dblclick();
    await expect.poll(() => scaleOf(page)).toBeCloseTo(2.5, 1);
    await area.dblclick();
    await expect.poll(() => scaleOf(page)).toBe(1);
    await area.hover();
    // The mobile project (Pixel 7, ratio 2.625) gets the delta in CSS px, so
    // 300 arrived as about 114 (1.19x); 600 is 1.41x there, 2.46x on desktop.
    await page.mouse.wheel(0, -600);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
  });

  test("keeps the small cards and the other-mice list free of the button", async ({
    page,
  }) => {
    await expect(page.locator(".results-photoZoom-btn")).toHaveCount(1);
    // The cards have photos of their own in this fixture, and no button.
    await expect(
      page.locator(".results-others-grid .results-photo-img"),
    ).not.toHaveCount(0);
    await expect(
      page.locator(".results-others-grid .results-photoZoom-btn"),
    ).toHaveCount(0);
    await expect(page.locator(".results-otherMice-list button")).toHaveCount(0);
  });
});

/**
 * Two touch points through the DevTools protocol (Chromium turns them into
 * pointer events). A real phone is still the proper test of a pinch; this only
 * checks that a second finger landing on the scrim neither closes the dialog
 * nor stops a pinch on the photo from zooming.
 */
test.describe("pinch safety", () => {
  test.use({ hasTouch: true });

  test("a second finger on the scrim does not close the dialog, and two fingers on the photo zoom it", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "needs the DevTools protocol");
    await stubScan(page);
    await page.goto(`/results/${SCAN_ID}`);
    await page.locator(".results-photoZoom-btn").tap();
    const dialog = page.locator("dialog.results-photoDialog");
    await expect(dialog).toBeVisible();

    const box = await page.locator(".results-photoDialog-area").boundingBox();
    if (!box) throw new Error("the photo area has no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    type Finger = { x: number; y: number; id: number };
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: Finger[],
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : points,
      });

    // One finger on the photo, one on the scrim (the corner), then both lift.
    await touch("touchStart", [{ x: cx, y: cy, id: 1 }]);
    await touch("touchStart", [
      { x: cx, y: cy, id: 1 },
      { x: 3, y: 3, id: 2 },
    ]);
    await touch("touchEnd", []);
    await expect(dialog).toBeVisible();

    // A pinch outwards on the photo.
    await touch("touchStart", [
      { x: cx - 20, y: cy, id: 1 },
      { x: cx + 20, y: cy, id: 2 },
    ]);
    for (const d of [40, 70, 100]) {
      await touch("touchMove", [
        { x: cx - d, y: cy, id: 1 },
        { x: cx + d, y: cy, id: 2 },
      ]);
    }
    await touch("touchEnd", []);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.5);
    await expect(dialog).toBeVisible();
  });
});

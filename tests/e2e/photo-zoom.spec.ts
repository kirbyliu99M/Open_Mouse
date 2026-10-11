import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Click the big photo to enlarge it (candidate, 2026-10-11): open, zoom by
 * keyboard, Esc, focus return, and the body scroll lock. The fit and analysis
 * routes are stubbed (no database in e2e) and the top mouse is given its real
 * committed photo, so the 480 px and 960 px files both exist.
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
const WITH_PHOTO = {
  ...FIXTURE,
  results: FIXTURE.results.map((r, i) =>
    i === 0
      ? { ...r, mouse: { ...r.mouse, imageUrl: `/images/mice/${TOP}.webp` } }
      : r,
  ),
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
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty("open", true);
    // Native modal: the dialog is in the top layer and has its own name.
    await expect(dialog).toHaveAccessibleName(/Logitech|G PRO X/i);

    // The page behind does not scroll.
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
    ).toBe("hidden");

    // The big file is swapped in once it has loaded.
    await expect(page.locator(".results-photoDialog-img")).toHaveAttribute(
      "src",
      `/images/mice/l/${TOP}.webp`,
    );

    // Keyboard zoom: + zooms in, + again more, 0 resets, - stays at 1x.
    expect(await scaleOf(page)).toBe(1);
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.5);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("0");
    await expect.poll(() => scaleOf(page)).toBe(1);
    await page.keyboard.press("-");
    await expect.poll(() => scaleOf(page)).toBe(1);

    // Esc closes, focus is back on the button, and the page scrolls again.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
    ).not.toBe("hidden");
  });

  test("closes by the close button and by a click on the scrim, and reopens at 1x", async ({
    page,
  }) => {
    const open = page.locator(".results-photoZoom-btn");
    const dialog = page.locator("dialog.results-photoDialog");

    await open.click();
    await page.keyboard.press("+");
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
    await dialog.getByRole("button", { name: /關閉|Close/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    // Zoom is reset on close.
    await open.click();
    expect(await scaleOf(page)).toBe(1);

    // A press on the scrim (the dialog itself, outside the photo) closes it.
    await page.mouse.click(4, 4);
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("double click toggles 2.5x and the wheel zooms", async ({ page }) => {
    await page.locator(".results-photoZoom-btn").click();
    const area = page.locator(".results-photoDialog-area");
    await area.dblclick();
    await expect.poll(() => scaleOf(page)).toBeCloseTo(2.5, 1);
    await area.dblclick();
    await expect.poll(() => scaleOf(page)).toBe(1);
    await area.hover();
    await page.mouse.wheel(0, -300);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.2);
  });

  test("keeps the small cards and the other-mice list free of the button", async ({
    page,
  }) => {
    await expect(page.locator(".results-photoZoom-btn")).toHaveCount(1);
    await expect(
      page.locator(".results-others-grid .results-photoZoom-btn"),
    ).toHaveCount(0);
  });
});

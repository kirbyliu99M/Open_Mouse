import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * V3.2 F11 (Kirby's phone test, 2026-10-21: "after pressing other buttons the
 * results page's back no longer works"): the buttons on a results page add no
 * history entries, so the browser's back leaves the results. Only a card that
 * opens another mouse's page adds one. The scan routes are stubbed (no
 * database in e2e). Run alone: `--project=chromium --workers=1`.
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
) as { scanId: string; results: { mouse: { slug: string } }[] };

const SCAN_ID = FIXTURE.scanId;
const MAIN = `/results/${SCAN_ID}`;
const RANK_2 = FIXTURE.results[1].mouse.slug;

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubScan(page: Page) {
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    json(route, 200, FIXTURE),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    json(route, 503, { error: "stub" }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    json(route, 404, { error: "Scan not found." }),
  );
  // Rated already: the feedback sheet stays away and covers nothing.
  await page.route(`**/api/scans/${SCAN_ID}/feedback`, (route) =>
    json(route, 200, { answered: true }),
  );
}

/** A page before the results, so "left the results" has somewhere to land. */
async function startOutside(page: Page) {
  await page.goto("about:blank");
}

const historyLength = (page: Page) => page.evaluate(() => history.length);

test.describe("results: the back button leaves the results page", () => {
  // The phone layout: the filter is a bottom sheet (a modal dialog).
  test.use({ viewport: { width: 390, height: 844 } });

  test("toggle, open and close the filter, open Details, then back", async ({
    page,
  }) => {
    // The dev server compiles the route on first use (about 10 s measured on
    // the V3.2 branch, results-detail-flow.spec.ts).
    test.setTimeout(90_000);
    await stubScan(page);
    await startOutside(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible({
      timeout: 30_000,
    });
    const before = await historyLength(page);

    // The shape toggle: another segment, the URL may change, no new entry.
    const options = page.locator(
      '.results-shapeToggle [role="radio"][aria-checked="false"]',
    );
    await options.first().click();
    await expect(
      page.locator('.results-shapeToggle [role="radio"][aria-checked="true"]'),
    ).toHaveCount(1);

    // The filter sheet: open it, then close it with its X (48 x 48).
    await page.locator(".results-filterButton").click();
    const dialog = page.locator("dialog.results-sheet");
    await expect(dialog).toBeVisible();
    const close = dialog.locator(".results-sheet-close");
    const box = (await close.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(dialog).toHaveCount(0);

    // Details.
    const details = page.locator(".results-details");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");

    expect(await historyLength(page)).toBe(before);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/results\//);
  });

  test("a card adds one entry; back returns to the list, the next back leaves", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await stubScan(page);
    await startOutside(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible({
      timeout: 30_000,
    });

    await page.locator(".results-card").filter({ hasText: "G305" }).click();
    await expect(page).toHaveURL(`${MAIN}/m/${RANK_2}`, { timeout: 30_000 });
    // From the detail page, the first place goes back to the list's entry.
    await page.locator(".results-card").first().click();
    await expect(page).toHaveURL(MAIN);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/results\//);
  });
});

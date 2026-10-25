import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * V3.2 F24 (Kirby 2026-10-26, candidate / 未拍板): the share card follows the
 * list on screen. Under the 人體工學 segment, when the overall #1 is a
 * symmetrical mouse, the card is about the ergonomic #1 (its file name is that
 * mouse's), and the button is the usual one, not "share the overall #1".
 * The scan routes are stubbed (no database in e2e). Run alone through the
 * safe runner: `--project=chromium --workers=1`.
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
  results: { rank: number; mouse: { slug: string } }[];
};

const SCAN_ID = FIXTURE.scanId;
const MAIN = `/results/${SCAN_ID}`;
/** The ergonomic mice of the stub; every other mouse is symmetrical. */
const ERGONOMIC = new Set(["razer-deathadder-v3", "zowie-ec2"]);
const ERGO_FIRST = FIXTURE.results
  .filter((r) => ERGONOMIC.has(r.mouse.slug))
  .sort((a, b) => a.rank - b.rank)[0]!.mouse.slug;
const OVERALL_FIRST = FIXTURE.results.find((r) => r.rank === 1)!.mouse.slug;

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubScan(page: Page) {
  const fit = {
    ...FIXTURE,
    results: FIXTURE.results.map((r) => ({
      ...r,
      mouse: {
        ...r.mouse,
        shape: ERGONOMIC.has(r.mouse.slug) ? "ergonomic" : "symmetrical",
      },
    })),
  };
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    json(route, 200, fit),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    json(route, 503, { error: "stub" }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    json(route, 404, { error: "Scan not found." }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/feedback`, (route) =>
    json(route, 200, { answered: true }),
  );
  await page.route("**/api/auth/session", (route) => json(route, 200, {}));
}

test.describe("results: the share card follows the shape segment (F24)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("under 人體工學 the card is the ergonomic #1, from the usual button", async ({
    page,
  }) => {
    expect(ERGO_FIRST).not.toBe(OVERALL_FIRST);
    await stubScan(page);
    await page.goto(MAIN);
    await page
      .locator('.results-shapeToggle [role="radio"]')
      .filter({ hasText: /人體工學|Ergonomic/ })
      .click();
    await expect(page).toHaveURL(/grip=ergonomic/);

    // The usual primary button, no "share the overall #1" note.
    await expect(page.getByTestId("share-filter-note")).toHaveCount(0);
    await page
      .locator('[data-testid="share-card-button"]:visible')
      .first()
      .click();
    const preview = page.getByTestId("share-preview");
    await expect(preview).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByTestId("share-preview-download").click({ timeout: 30_000 });
    expect((await download).suggestedFilename()).toBe(
      `palmate-${ERGO_FIRST}.png`,
    );
  });

  test("with no filter the card is still the overall #1", async ({ page }) => {
    await stubScan(page);
    await page.goto(MAIN);
    await page
      .locator('[data-testid="share-card-button"]:visible')
      .first()
      .click();
    await expect(page.getByTestId("share-preview")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByTestId("share-preview-download").click({ timeout: 30_000 });
    expect((await download).suggestedFilename()).toBe(
      `palmate-${OVERALL_FIRST}.png`,
    );
  });
});

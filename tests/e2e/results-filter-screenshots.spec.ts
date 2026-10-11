import { mkdir } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { buildFilterFit, FILTER_SCAN_ID, slugFor } from "./fixtures/filter-fit";

/**
 * Evidence screenshots of the results-page filter (FILTER-1), opt-in:
 *
 *   FILTER_SHOTS=1 npx playwright test tests/e2e/results-filter-screenshots.spec.ts --project=chromium
 *
 * They go OUTSIDE the repo (design-exports/filter-1 next to it), at 390, 320 and
 * 1440 px wide, the backend stubbed with the 30-card fixture. A normal run
 * skips this file.
 */
const OUTPUT =
  process.env.FILTER_SHOTS_DIR ??
  "C:/Users/kirby/Desktop/Mouse Shape Project/design-exports/filter-1";

test.use({ locale: "zh-TW" });
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(process.env.FILTER_SHOTS !== "1", "Opt-in: set FILTER_SHOTS=1.");
  test.skip(testInfo.project.name !== "chromium", "One project is enough.");
  await mkdir(OUTPUT, { recursive: true });
  const fit = buildFilterFit();
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route(`**/api/scans/${FILTER_SCAN_ID}/fit`, (r) => json(r, fit));
  await page.route(`**/api/scans/${FILTER_SCAN_ID}/analysis`, (r) =>
    json(r, {
      output: {
        headline: "Analysis headline",
        whyTopPick: "Analysis body about the overall first pick.",
        tradeoffs: [],
        whatToAvoid: [],
        caveats: [],
      },
      source: "model",
      cached: false,
    }),
  );
});

const MAIN = `/results/${FILTER_SCAN_ID}`;
const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "320", width: 320, height: 568 },
  { name: "1440", width: 1440, height: 900 },
] as const;

async function shot(page: Page, name: string, width: string) {
  // Let the layout and any entrance motion settle.
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `${OUTPUT}/${name}-${width}.png`,
    fullPage: true,
  });
}

const states: { name: string; url: string }[] = [
  { name: "01-no-filter", url: MAIN },
  { name: "02-two-filters", url: `${MAIN}?brand=Razer&conn=wireless` },
  { name: "03-filtered-first-swapped", url: `${MAIN}?weight=gte90` },
  { name: "04-overall-first-still-matches", url: `${MAIN}?brand=Zowie` },
  { name: "05-no-match", url: `${MAIN}?brand=Razer&size=small&conn=wired` },
  { name: "07-one-left", url: `${MAIN}?brand=Roccat&size=large` },
  {
    name: "08-detail-from-filtered-list",
    url: `${MAIN}/m/${slugFor("Razer", "Cobra Pro")}?brand=Razer&conn=wireless`,
  },
];

for (const w of WIDTHS) {
  test.describe(`${w.name} px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    for (const s of states) {
      test(s.name, async ({ page }) => {
        await page.goto(s.url);
        await expect(page.locator(".results-view")).toBeVisible();
        await shot(page, s.name, w.name);
      });
    }

    test("06-sheet-open-or-sidebar-expanded", async ({ page }) => {
      await page.goto(`${MAIN}?brand=Razer`);
      if (w.width < 1024) {
        await page.getByRole("button", { name: /^篩選/ }).click();
        const sheet = page.getByRole("dialog", { name: "篩選" });
        await expect(sheet).toBeVisible();
        await page.waitForTimeout(600);
        // The sheet is fixed to the viewport: a viewport screenshot is the picture.
        await page.screenshot({
          path: `${OUTPUT}/06-sheet-open-${w.name}.png`,
        });
        // The same sheet scrolled to the weight group, with its missing-data
        // note (one mouse in the fixture has no weight).
        await sheet.getByRole("button", { name: "關閉篩選" }).click();
        await expect(sheet).toHaveCount(0);
        await page.goto(MAIN);
        await page.getByRole("button", { name: /^篩選/ }).click();
        await sheet.getByRole("button", { name: /^重量/ }).click();
        await sheet.getByRole("checkbox", { name: /^90 g 以上/ }).click();
        await sheet.locator(".results-facet-missing").scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${OUTPUT}/06b-sheet-weight-${w.name}.png`,
        });
      } else {
        const closed = page.locator(
          '.results-facet-toggle[aria-expanded="false"]',
        );
        while ((await closed.count()) > 0) await closed.first().click();
        await shot(page, "06-sidebar-all-groups-open", w.name);
      }
    });
  });
}

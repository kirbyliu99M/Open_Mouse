import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { buildFilterFit, FILTER_SCAN_ID, slugFor } from "./fixtures/filter-fit";

/**
 * axe (WCAG 2.2 AA and the A rules under them) on the results page's filter,
 * in both layouts: the sidebar (`chromium`, 1280 px) and the sheet (`mobile`).
 * Violations fail. What axe could not decide ("incomplete") is not hidden: it
 * is attached to the run, and only colour rules may be left open here (a
 * translucent footer over scrolling content is something axe cannot read
 * through; the sheet's footer text is checked on a solid background instead
 * by the reduced-transparency state below).
 */
test.use({ locale: "zh-TW" });

const FIT = buildFilterFit();
const MAIN = `/results/${FILTER_SCAN_ID}`;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

async function stub(page: Page) {
  await page.route(`**/api/scans/${FILTER_SCAN_ID}/fit`, (r) => json(r, FIT));
  await page.route(`**/api/scans/${FILTER_SCAN_ID}/analysis`, (r) =>
    json(r, {
      output: {
        headline: "Headline",
        whyTopPick: "Body.",
        tradeoffs: [],
        whatToAvoid: [],
        caveats: [],
      },
      source: "model",
      cached: false,
    }),
  );
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function scan(page: Page, state: string, testInfo: { attach: Function }) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe-incomplete-${state}.json`, {
    body: JSON.stringify(
      results.incomplete.map((i) => ({
        id: i.id,
        nodes: i.nodes.map((n) => n.target),
      })),
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
    `${state}: violations`,
  ).toEqual([]);
  // Whatever is left open must be a colour question, nothing structural.
  expect(
    results.incomplete.map((i) => i.id).filter((id) => id !== "color-contrast"),
    `${state}: open items other than colour`,
  ).toEqual([]);
}

const states: [string, string][] = [
  ["plain", MAIN],
  ["two filters, large card swapped", `${MAIN}?brand=Razer&conn=wireless`],
  ["overall #1 still matches", `${MAIN}?brand=Zowie`],
  ["a group with a choice and missing data", `${MAIN}?weight=50-69`],
  ["no match", `${MAIN}?brand=Razer&size=small&conn=wired`],
  ["one left", `${MAIN}?brand=Roccat&size=large`],
  [
    "a detail page from a filtered list",
    `${MAIN}/m/${slugFor("Razer", "Cobra Pro")}?brand=Razer&conn=wireless`,
  ],
];

for (const [state, url] of states) {
  test(`axe: ${state}`, async ({ page }, testInfo) => {
    await stub(page);
    await page.goto(url);
    await expect(page.locator(".results-view")).toBeVisible();
    // All groups open, so every option is on the page for axe.
    if (isDesktop(page)) {
      for (const header of await page
        .locator('.results-facet-toggle[aria-expanded="false"]')
        .all())
        await header.click();
    }
    await scan(page, state, testInfo);
  });
}

test("axe: the sheet open (phone layout)", async ({ page }, testInfo) => {
  test.skip(isDesktop(page), "The sheet is the phone layout.");
  await stub(page);
  await page.goto(`${MAIN}?brand=Razer`);
  await page.getByRole("button", { name: /^篩選/ }).click();
  await expect(page.getByRole("dialog", { name: "篩選" })).toBeVisible();
  for (const header of await page
    .locator('.results-sheet .results-facet-toggle[aria-expanded="false"]')
    .all())
    await header.click();
  await scan(page, "sheet open", testInfo);
});

test("axe: the sheet at 320 px, more contrast and reduced transparency", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(page), "The sheet is the phone layout.");
  await stub(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ contrast: "more", reducedMotion: "reduce" });
  await page.goto(`${MAIN}?brand=Razer`);
  await page.getByRole("button", { name: /^篩選/ }).click();
  await expect(page.getByRole("dialog", { name: "篩選" })).toBeVisible();
  await scan(page, "sheet 320 more contrast", testInfo);
  // Nothing needs a sideways scroll inside the sheet.
  const overflow = await page
    .getByRole("dialog", { name: "篩選" })
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

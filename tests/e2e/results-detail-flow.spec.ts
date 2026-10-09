import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * The path through the results pages: main page, a detail page for rank 2,
 * back to the main page, Details opened, then a reload on the detail page.
 * The fit and analysis routes are stubbed (there is no database in e2e), and
 * counted: the fit is requested once per scan however the person moves between
 * the pages, and the written analysis only for the main page.
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
const RANK_1 = FIXTURE.results[0].mouse.slug;
const RANK_2 = FIXTURE.results[1].mouse.slug; // logitech-g305
const RANK_6 = FIXTURE.results[5].mouse.slug;

const ANALYSIS = {
  output: {
    headline: "A close match for your claw grip",
    whyTopPick: "The top pick's length and grip width both land close.",
    tradeoffs: ["It runs slightly heavier than you prefer."],
    whatToAvoid: ["Mice with an aggressive back hump."],
    caveats: [],
  },
  source: "model",
  cached: false,
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Stubs the scan's routes and returns how many times each was requested. */
async function stubScan(page: Page) {
  const calls = { fit: 0, analysis: 0 };
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) => {
    calls.fit += 1;
    return fulfillJson(route, 200, FIXTURE);
  });
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) => {
    calls.analysis += 1;
    return fulfillJson(route, 200, ANALYSIS);
  });
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    fulfillJson(route, 404, { error: "Scan not found." }),
  );
  return calls;
}

/** The share link in the top bar and the primary share button are both shown. */
async function expectShareButtons(page: Page) {
  await expect(
    page.locator('[data-testid="share-card-button"]:visible'),
  ).toHaveCount(2);
  await expect(
    page.locator(".results-topBar [data-testid='share-card-button']"),
  ).toBeVisible();
}

async function openDetails(page: Page) {
  const details = page.locator(".results-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

test.describe("results: main page and rank 2 to 5 detail pages", () => {
  test("main, then rank 2, back to main, Details, then a reload on the detail page", async ({
    page,
  }) => {
    const calls = await stubScan(page);

    // Main page: rank 1, the hand type, and the other four of the top five.
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toHaveText(
      "#1 · Logitech",
    );
    await expect(page.locator(".results-hand-title")).toHaveText(
      "Medium mouse · Claw grip · Wide",
    );
    const cards = page.locator(".results-card");
    await expect(cards).toHaveCount(4);
    await expect
      .poll(() => calls.analysis, { message: "analysis for rank 1" })
      .toBe(1);
    expect(calls.fit).toBe(1);
    await expectShareButtons(page);

    // To rank 2: same layout, a new URL, no second fit request, no analysis.
    await cards.filter({ hasText: "G305" }).click();
    await expect(page).toHaveURL(`${MAIN}/m/${RANK_2}`);
    await expect(page.locator(".results-score-rank")).toHaveText(
      "#2 · Logitech",
    );
    await expect(page.locator(".results-score-model")).toHaveText(
      "G305 Lightspeed",
    );
    await expect(page.locator(".results-hand-title")).toBeVisible();
    await expect(page.locator(".results-why-list li")).toHaveCount(3);
    // Rank 1 comes first among the other picks, and this mouse is not one.
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toHaveAttribute("href", MAIN);
    await expect(cards.filter({ hasText: "G305" })).toHaveCount(0);
    expect(calls.fit).toBe(1);
    expect(calls.analysis).toBe(1);

    await expectShareButtons(page);

    // The written analysis is not part of a detail page, even with Details open.
    await openDetails(page);
    await expect(page.locator(".results-analysis")).toHaveCount(0);
    await expect(page.locator(".results-subscoreBar")).toHaveCount(6);

    // Back to the main page: no refetch, Details closed again, analysis kept.
    await cards.first().click();
    await expect(page).toHaveURL(MAIN);
    await expect(page.locator(".results-score-rank")).toHaveText(
      "#1 · Logitech",
    );
    await expect(page.locator(".results-details")).not.toHaveAttribute(
      "open",
      "",
    );
    expect(calls.fit).toBe(1);
    expect(calls.analysis).toBe(1);

    await openDetails(page);
    await expect(page.locator(".results-subscoreBar")).toHaveCount(6);
    await expect(page.locator(".results-analysis-ready")).toBeVisible();

    // A reload on a detail page fetches again and stays on that page.
    await page.goto(`${MAIN}/m/${RANK_2}`);
    await expect(page.locator(".results-score-model")).toHaveText(
      "G305 Lightspeed",
    );
    await expect(page.locator(".results-details")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.reload();
    await expect(page.locator(".results-score-model")).toHaveText(
      "G305 Lightspeed",
    );
    await expect(page).toHaveURL(`${MAIN}/m/${RANK_2}`);
    expect(calls.fit).toBe(3); // the main page, the direct visit, the reload
    // A detail page that is loaded first never asks for the analysis.
    expect(calls.analysis).toBe(1);
  });

  for (const [name, slug] of [
    ["rank 1", RANK_1],
    ["rank 6", RANK_6],
    ["an unknown mouse", "no-such-mouse"],
  ] as const) {
    test(`/m/ for ${name} goes back to the main page`, async ({ page }) => {
      await stubScan(page);
      await page.goto(`${MAIN}/m/${slug}`);
      await expect(page).toHaveURL(MAIN);
      await expect(page.locator(".results-score-rank")).toHaveText(
        "#1 · Logitech",
      );
    });
  }

  test("a mouse beyond the top five is a row in Other mice, with no link", async ({
    page,
  }) => {
    await stubScan(page);
    await page.goto(MAIN);
    await page.locator(".results-otherMice summary").click();
    const rows = page.locator(".results-otherMice-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.locator("a")).toHaveCount(0);
  });

  test("the detail routes keep robots noindex and have their own title", async ({
    page,
  }) => {
    await stubScan(page);
    await page.goto(MAIN);
    await expect(page).toHaveTitle(/^Your results/);
    await page.goto(`${MAIN}/m/${RANK_2}`);
    await expect(page).toHaveTitle(/^Another pick/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("works at 360 px wide with no horizontal scroll, on both pages", async ({
    page,
  }) => {
    await stubScan(page);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of [MAIN, `${MAIN}/m/${RANK_2}`]) {
      await page.goto(path);
      await expect(page.locator(".results-score-model")).toBeVisible();
      await openDetails(page);
      await page.locator(".results-otherMice summary").click();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("shows a product photo when the response has one, and the silhouette otherwise", async ({
    page,
  }) => {
    await stubScan(page);
    await page.unroute(`**/api/scans/${SCAN_ID}/fit`);
    await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
      fulfillJson(route, 200, {
        ...FIXTURE,
        results: FIXTURE.results.map((r, i) =>
          i === 0
            ? {
                ...r,
                mouse: { ...r.mouse, imageUrl: "/images/hand-on-a4.svg" },
              }
            : r,
        ),
      }),
    );
    await page.goto(MAIN);
    const hero = page.locator(".results-hero-photo");
    await expect(hero.locator("img")).toHaveAttribute(
      "src",
      "/images/hand-on-a4.svg",
    );
    // The other picks carry no photo, so they show the silhouette.
    await expect(
      page.locator(".results-card .results-photo-silhouette").first(),
    ).toBeVisible();
  });
});

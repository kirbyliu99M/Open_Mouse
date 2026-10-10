import { expect, test, type Page } from "@playwright/test";
import {
  fitResponseSchema,
  type FitResponse,
} from "../../src/lib/contracts/fit";
import { fitPath, resultsPagePath } from "../../src/lib/contracts/routes";
import {
  brandOrder,
  filteredView,
  matchCount,
  parseFilters,
  serializeFilters,
} from "../../src/lib/results/filters";
import { deleteScans, submitScan } from "./helpers";

/**
 * The results-page filter (FILTER-1, candidate) against a REAL backend, nothing
 * mocked: a real scan is submitted, the real fit route answers, and the page's
 * filter is driven the way a person does. Meant for a local backend (a local
 * Postgres behind the Neon HTTP driver, seeded) and for a deployment alike:
 *
 *   BASE_URL=http://127.0.0.1:3000 npx playwright test -c playwright.live.config.ts tests/e2e-live/results-filter.spec.ts
 *
 * Flow: apply on the results page, reload, a detail page opened from the
 * filtered list, back, a deep link in a fresh page, and the old URL with no
 * filter. What the page must show is worked out here with the filter's own pure
 * functions from the real response (the numbers the page shows are checked
 * against them, never against numbers typed into the test), plus one check that
 * the facts the filter reads (shape, connectivity) really arrive from the
 * server.
 *
 * The browser is zh-TW (the filter's words are Chinese). The scan is deleted
 * afterwards, also when a step fails.
 */
test.use({ locale: "zh-TW" });

const created: string[] = [];

test.afterEach(async ({ page }) => {
  await deleteScans(page, created);
  created.length = 0;
});

async function realFit(page: Page, scanId: string): Promise<FitResponse> {
  const body = await page.evaluate(async (path) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (res.status !== 200) throw new Error(`fit returned ${res.status}`);
    return res.json();
  }, fitPath(scanId));
  return fitResponseSchema.parse(body);
}

const found = (page: Page) =>
  page.locator(".results-sidebar-count, .results-filterBar-count");

/** Chooses one option by its name, through the sidebar or the sheet. */
async function choose(page: Page, group: string, name: RegExp | string) {
  const sheet = (page.viewportSize()?.width ?? 0) < 1024;
  if (sheet) {
    await page.getByRole("button", { name: /^篩選/ }).click();
    await expect(page.getByRole("dialog", { name: "篩選" })).toBeVisible();
  }
  const scope = sheet ? page.getByRole("dialog", { name: "篩選" }) : page;
  const header = scope.getByRole("button", { name: new RegExp(`^${group}`) });
  if ((await header.getAttribute("aria-expanded")) === "false")
    await header.click();
  const box = scope.getByRole("checkbox", {
    name: typeof name === "string" ? new RegExp(`^${name}[，,]`) : name,
  });
  // Brands past the featured five are behind a link.
  if ((await box.count()) === 0)
    await scope.getByRole("button", { name: /^顯示其他 \d+ 個品牌$/ }).click();
  await box.click();
  if (sheet)
    await scope.getByRole("button", { name: /^查看 \d+ 款滑鼠$/ }).click();
}

for (const layout of ["phone sheet", "desktop sidebar"] as const) {
  test.describe(layout, () => {
    if (layout === "desktop sidebar")
      test.use({
        viewport: { width: 1280, height: 900 },
        hasTouch: false,
        isMobile: false,
      });

    test("apply, reload, a detail page, back, a deep link, the old URL", async ({
      page,
    }) => {
      const scanId = await submitScan(page, created);
      const main = resultsPagePath(scanId);
      const fit = await realFit(page, scanId);

      // The server fills the facts the filter reads.
      const withShape = fit.results.filter((e) => e.mouse.shape != null);
      const withConn = fit.results.filter((e) => e.mouse.connectivity != null);
      expect(withShape.length, "cards with a shape").toBeGreaterThan(0);
      expect(withConn.length, "cards with a connectivity").toBeGreaterThan(0);

      // A brand with a few cards, and 無線, give a filter that keeps several
      // cards and (usually) swaps the large card.
      const { featured, rest } = brandOrder(fit);
      const brand =
        [...featured, ...rest].find(
          (b) =>
            fit.results.some(
              (e) => e.mouse.brand === b && e.mouse.connectivity === "wireless",
            ) &&
            matchCount(
              fit,
              parseFilters(`brand=${encodeURIComponent(b)}&conn=wireless`),
            ) >= 3,
        ) ?? featured[0]!;
      const filters = parseFilters(
        `brand=${encodeURIComponent(brand)}&conn=wireless`,
      );
      const query = serializeFilters(filters);
      const view = filteredView(fit, filters);
      expect(view.count, "the filter keeps something").toBeGreaterThan(0);

      // 1. Apply, through the page.
      await page.goto(main);
      await expect(found(page)).toHaveText(`找到 ${fit.results.length} 款`);
      await choose(page, "品牌", new RegExp(`^${brand}[，,]`));
      await choose(page, "連線方式", "無線");
      await expect(page).toHaveURL(
        new RegExp(`\\?${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      );
      await expect(found(page)).toHaveText(`找到 ${view.count} 款`);
      await expect(page.locator(".results-score-model")).toHaveText(
        view.large!.entry.mouse.model,
      );
      if (view.swapped) {
        await expect(page.locator(".results-badge")).toHaveText(
          "篩選後第 1 名",
        );
        await expect(page.locator(".results-analysisLine")).toBeVisible();
      } else {
        await expect(page.locator(".results-badge")).toHaveCount(0);
      }
      // The share card is always the overall #1, so the button says so.
      await expect(
        page
          .locator(".results-share-hero, .results-share-bottom")
          .locator(".shareCard-note")
          .first(),
      ).toBeAttached();

      // 2. Reload: the same page.
      await page.reload();
      await expect(page.locator(".results-score-model")).toHaveText(
        view.large!.entry.mouse.model,
      );
      await expect(found(page)).toHaveText(`找到 ${view.count} 款`);
      expect(new URL(page.url()).search).toBe(`?${query}`);

      // 3. A detail page from the filtered list, with the filter kept.
      if (view.picks.length > 0) {
        const second = view.picks[0]!;
        const card = page.locator(".results-others .results-card").first();
        await expect(card).toContainText(second.entry.mouse.model);
        await card.click();
        await expect(page).toHaveURL(
          new RegExp(`/m/${second.entry.mouse.slug}\\?`),
        );
        expect(new URL(page.url()).search).toBe(`?${query}`);
        await expect(page.locator(".results-badge")).toHaveText(
          "篩選後第 2 名",
        );
        await expect(page.locator(".results-score-model")).toHaveText(
          second.entry.mouse.model,
        );
        // 4. Back: the main page, still filtered.
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`${main}\\?`));
        await expect(page.locator(".results-score-model")).toHaveText(
          view.large!.entry.mouse.model,
        );
        await expect(found(page)).toHaveText(`找到 ${view.count} 款`);
      }

      // 5. A deep link in a fresh page of the same browser context.
      const fresh = await page.context().newPage();
      await fresh.goto(`${main}?${query}`);
      await expect(fresh.locator(".results-score-model")).toHaveText(
        view.large!.entry.mouse.model,
      );
      await expect(found(fresh)).toHaveText(`找到 ${view.count} 款`);
      await fresh.close();

      // 6. The old URL, with no parameters: the plain page.
      await page.goto(main);
      await expect(found(page)).toHaveText(`找到 ${fit.results.length} 款`);
      await expect(page.locator(".results-badge")).toHaveCount(0);
      await expect(page.locator(".results-score-model")).toHaveText(
        fit.results[0]!.mouse.model,
      );
    });
  });
}

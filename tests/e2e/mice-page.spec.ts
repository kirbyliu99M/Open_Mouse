import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The all-mice page (`/mice`, PAGE-1, candidate / 未拍板) in a browser.
 *
 * NOT RUN by the builder (the machine crashes under Chromium tests; AGENTS.md).
 * To run: `npx playwright test tests/e2e/mice-page.spec.ts`, one project at a
 * time, with `DATABASE_URL` pointing at a seeded database.
 *
 * The page reads the catalogue on the server, so a browser cannot stub it the
 * way the results page's fit response is stubbed. Without a database (CI) the
 * page shows its empty state: the first group below runs in that case and the
 * data groups skip themselves; with a database it is the other way round. Both
 * are written against the page's behaviour, not against a row count (the
 * catalogue is about 406 rows today and will change).
 *
 * `chromium` is 1280 px wide (the sidebar and the table), `mobile` is a phone
 * (the filter sheet and the cards).
 */
test.use({ locale: "en-US" });

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const UNAVAILABLE = "The mouse list could not be loaded";

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;

async function open(page: Page, query = "") {
  const response = await page.goto(`/mice${query}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return response;
}

async function hasData(page: Page): Promise<boolean> {
  return (await page.getByText(UNAVAILABLE).count()) === 0;
}

/** The count in the filter's own line (the sidebar's, or the phone bar's). */
async function foundCount(page: Page): Promise<number> {
  const line = page
    .locator(".results-sidebar-count, .results-filterBar-count")
    .first();
  const text = (await line.textContent()) ?? "";
  const m = /^(\d+) mice? found$/.exec(text.trim());
  if (!m) throw new Error(`unexpected count line: ${text}`);
  return Number(m[1]);
}

/** The rows the layout shows: table rows on a wide screen, cards below. */
const rows = (page: Page) =>
  isDesktop(page)
    ? page.locator(".mice-table tbody tr")
    : page.locator(".mice-card");

/** Waits for the layout the screen calls for (the server renders the phone layout first). */
async function layoutReady(page: Page) {
  await expect(page.locator(".results-body")).toHaveAttribute(
    "data-filter",
    isDesktop(page) ? "sidebar" : "sheet",
  );
}

const option = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: new RegExp(`^${name}, `) });

async function openGroup(page: Page, name: string) {
  const header = page.getByRole("button", { name: new RegExp(`^${name}`) });
  if ((await header.getAttribute("aria-expanded")) === "false")
    await header.click();
}

/** Opens the phone's sheet, runs `choose`, and applies it. */
async function viaSheet(page: Page, choose: () => Promise<void>) {
  await page.getByRole("button", { name: /^Filter/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filter" });
  await expect(sheet).toBeVisible();
  await choose();
  await sheet.getByRole("button", { name: /^View \d+ mice?$/ }).click();
  await expect(sheet).toBeHidden();
}

/** Applies a filter option in whichever layout the screen has. */
async function choose(page: Page, group: string | null, name: string) {
  if (isDesktop(page)) {
    if (group) await openGroup(page, group);
    await option(page, name).click();
  } else {
    await viaSheet(page, async () => {
      if (group) await openGroup(page, group);
      await option(page, name).click();
    });
  }
}

test.describe("the page itself (with or without a database)", () => {
  test("has the title, the subtitle, the search box, and the browser title", async ({
    page,
  }) => {
    const response = await open(page);
    // Never a 500: an unreadable catalogue is an empty list.
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "All mice" }),
    ).toBeVisible();
    await expect(
      page.getByText("Browse every mouse we compare."),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search brand or model" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("All mice · Palmate");
    await expect(page.locator("main h1")).toHaveCount(1);
  });

  test("is reached from the footer's Product group", async ({ page }) => {
    await page.goto("/how-it-works");
    await page
      .getByTestId("site-footer")
      .getByRole("link", { name: "All mice", exact: true })
      .click();
    await expect(page).toHaveURL(/\/mice$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "All mice" }),
    ).toBeVisible();
  });

  test("axe finds no WCAG 2.2 AA violation", async ({ page }) => {
    await open(page);
    await layoutReady(page);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });

  test("does not scroll sideways", async ({ page }) => {
    await open(page);
    await layoutReady(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("when the catalogue cannot be read, shows an empty state and 0 mice, not an error page (no database)", async ({
    page,
  }) => {
    await open(page);
    test.skip(await hasData(page), "a database is connected");
    await expect(page.getByText(UNAVAILABLE)).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
    expect(await foundCount(page)).toBe(0);
  });
});

test.describe("the list (needs a seeded database)", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    test.skip(!(await hasData(page)), "no database: the empty state shows");
    await layoutReady(page);
  });

  test("shows the first 50 rows, the count of all of them, and Show more adds 50 at a time", async ({
    page,
  }) => {
    const total = await foundCount(page);
    expect(total).toBeGreaterThan(50);
    await expect(rows(page)).toHaveCount(50);
    const more = page.getByRole("button", { name: "Show more" });
    await more.click();
    await expect(rows(page)).toHaveCount(Math.min(100, total));
    // The new rows start where the old ones ended, and focus lands on the first one.
    await expect(rows(page).nth(50)).toBeFocused();
    // Pressing until the end removes the button, and the last batch is the remainder.
    while ((await more.count()) > 0) await more.click();
    await expect(rows(page)).toHaveCount(total);
    await expect(more).toHaveCount(0);
  });

  test("lists by brand, then model", async ({ page }) => {
    const collator = new Intl.Collator("en", {
      numeric: true,
      sensitivity: "base",
    });
    const names = await page
      .locator(isDesktop(page) ? ".mice-table tbody th" : ".mice-card")
      .evaluateAll((els) =>
        els.map((el) => [
          el.querySelector(".mice-brand")?.textContent ?? "",
          el.querySelector(".mice-model")?.textContent ?? "",
        ]),
      );
    for (let i = 1; i < names.length; i += 1) {
      const [pb, pm] = names[i - 1]!;
      const [b, m] = names[i]!;
      expect(
        collator.compare(pb!, b!) || collator.compare(pm!, m!),
        `${pb} ${pm} before ${b} ${m}`,
      ).toBeLessThanOrEqual(0);
    }
  });

  test("the table (desktop) has the design's columns", async ({ page }) => {
    test.skip(!isDesktop(page), "the table is for wide screens");
    await expect(page.locator(".mice-table thead th")).toHaveText([
      "Mouse",
      "Size",
      "Shape",
      "Connection",
      "Length (mm)",
      "Width (mm)",
      "Height (mm)",
      "Weight (g)",
    ]);
    await expect(page.locator(".mice-card").first()).toBeHidden();
  });

  test("the cards (phone) show brand, model, three tags and the size line", async ({
    page,
  }) => {
    test.skip(isDesktop(page), "cards are for narrow screens");
    const card = page.locator(".mice-card").first();
    await expect(card.locator(".mice-brand")).not.toBeEmpty();
    await expect(card.locator(".mice-model")).not.toBeEmpty();
    await expect(card.locator(".mice-dims")).toContainText(/ mm/);
    await expect(page.locator(".mice-table")).toBeHidden();
  });

  test("a brand filter keeps only that brand, shows a chip, and Clear all brings everything back", async ({
    page,
  }) => {
    const all = await foundCount(page);
    await choose(page, null, "Logitech");
    const chips = page.getByRole("list", { name: "Applied filters" });
    await expect(
      chips.getByRole("button", { name: 'Remove "Logitech"' }),
    ).toBeVisible();
    const filtered = await foundCount(page);
    expect(filtered).toBeLessThan(all);
    const brands = await page
      .locator(".mice-brand")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => el.textContent),
      );
    expect(new Set(brands)).toEqual(new Set(["Logitech"]));
    await expect(page).toHaveURL(/brand=Logitech/);
    await page.getByRole("button", { name: "Clear all" }).first().click();
    expect(await foundCount(page)).toBe(all);
    await expect(page).not.toHaveURL(/brand=/);
  });

  test("the weight band is half-open: Under 50 g keeps only mice below 50 g", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "the weights are read from the table");
    await choose(page, "Weight", "Under 50 g");
    await expect(page).toHaveURL(/weight=lt50/);
    const grams = await page
      .locator(".mice-table tbody tr td:last-child")
      .allTextContents();
    expect(grams.length).toBeGreaterThan(0);
    for (const g of grams) expect(Number(g)).toBeLessThan(50);
  });

  test("the connection filter keeps a mouse with a value for it only", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "the connection is read from the table");
    await choose(page, "Connection", "Wired");
    const cells = await page
      .locator(".mice-table tbody tr td:nth-child(4)")
      .allTextContents();
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c).toBe("Wired");
  });

  test("search ignores case and white space, matches brand and model, and works with a filter", async ({
    page,
  }) => {
    const box = page.getByRole("searchbox", { name: "Search brand or model" });
    await box.fill("g pro");
    const spaced = await foundCount(page);
    expect(spaced).toBeGreaterThan(0);
    await box.fill("  G PRO ");
    expect(await foundCount(page)).toBe(spaced);
    await box.fill("gpro");
    expect(await foundCount(page)).toBe(spaced);
    await expect(page).toHaveURL(/q=gpro/);
    // Brand and model are both searched: the brand alone also finds rows.
    await box.fill("logitech");
    expect(await foundCount(page)).toBeGreaterThan(0);
    // A search together with a filter narrows both ways.
    await box.fill("g pro");
    await choose(page, "Connection", "Wireless");
    expect(await foundCount(page)).toBeLessThanOrEqual(spaced);
    // Nothing matches: the count says 0 and a sentence says why.
    await box.fill("zzzzzzzz");
    expect(await foundCount(page)).toBe(0);
  });

  test("the search and the filter survive a reload (they are in the address)", async ({
    page,
  }) => {
    await page.getByRole("searchbox").fill("pro");
    await choose(page, null, "Logitech");
    const before = await foundCount(page);
    await page.reload();
    await layoutReady(page);
    await expect(page.getByRole("searchbox")).toHaveValue("pro");
    expect(await foundCount(page)).toBe(before);
    await expect(
      page
        .getByRole("list", { name: "Applied filters" })
        .getByRole("button", { name: 'Remove "Logitech"' }),
    ).toBeVisible();
  });

  test("starting a new search starts again at the first 50 rows", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Show more" }).click();
    await expect(rows(page)).toHaveCount(100);
    await page.getByRole("searchbox").fill("");
    await page.getByRole("searchbox").fill("a");
    expect(await rows(page).count()).toBeLessThanOrEqual(50);
  });

  test("sends no field the page does not show (not in the HTML, not in the RSC payload)", async ({
    page,
    request,
  }) => {
    const response = await request.get("/mice");
    const body = await response.text();
    expect(body).not.toMatch(
      /sourceUrl|source_url|dataSource|data_source|humpPlacement|frontFlare|sideCurvature|thumbRest|ringFingerRest|handCompatibility|specRetrievedAt/,
    );
    // The page does carry the shown fields.
    expect(body).toContain("lengthMm");
    // And the data is read once into the page, not fetched by the browser later.
    const seen: string[] = [];
    page.on("request", (r) => {
      if (/\/api\//.test(r.url())) seen.push(r.url());
    });
    await page.reload();
    await layoutReady(page);
    expect(seen.filter((u) => /mice/.test(u))).toEqual([]);
  });

  test("axe finds no violation with a filter chosen and more rows shown", async ({
    page,
  }) => {
    await choose(page, null, "Logitech");
    const more = page.getByRole("button", { name: "Show more" });
    if ((await more.count()) > 0) await more.click();
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });
});

test.describe("on a phone (needs a seeded database)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isDesktop(page), "phone layout");
    await open(page);
    test.skip(!(await hasData(page)), "no database: the empty state shows");
    await layoutReady(page);
  });

  test("the filter opens as a bottom sheet; closing with Esc throws the draft away; View N mice applies it", async ({
    page,
  }) => {
    const all = await foundCount(page);
    await page.getByRole("button", { name: /^Filter/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filter" });
    await expect(sheet).toBeVisible();
    await option(page, "Wireless").click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(await foundCount(page)).toBe(all);
    await expect(page.getByRole("button", { name: /^Filter$/ })).toBeFocused();

    await viaSheet(page, async () => {
      await openGroup(page, "Connection");
      await option(page, "Wireless").click();
    });
    await expect(
      page.getByRole("button", { name: /^Filter \(1\)$/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Applied filters" })
        .getByRole("button", { name: 'Remove "Wireless"' }),
    ).toBeVisible();
    expect(await foundCount(page)).toBeLessThan(all);
  });

  test("the search comes first, above the Filter button", async ({ page }) => {
    const search = await page.getByRole("searchbox").boundingBox();
    const button = await page
      .getByRole("button", { name: /^Filter/ })
      .boundingBox();
    expect(search!.y).toBeLessThan(button!.y);
  });

  test("the controls are at least 44 px tall", async ({ page }) => {
    for (const locator of [
      page.getByRole("searchbox"),
      page.getByRole("button", { name: /^Filter/ }),
      page.getByRole("button", { name: "Show more" }),
    ]) {
      const box = await locator.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("in Chinese", () => {
  test.use({ locale: "zh-TW" });

  test("is rendered in zh-TW by the server", async ({ page }) => {
    await page.goto("/mice");
    await expect(
      page.getByRole("heading", { level: 1, name: "所有滑鼠" }),
    ).toBeVisible();
    await expect(page.getByText("瀏覽我們比對的每一支滑鼠。")).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "搜尋品牌或型號" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("所有滑鼠 · Palmate");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  });
});

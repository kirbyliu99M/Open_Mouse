import { expect, test, type Page, type Route } from "@playwright/test";
import {
  emptyFilters,
  filteredView,
  matchCount,
  parseFilters,
} from "../../src/lib/results/filters";
import { buildFilterFit, FILTER_SCAN_ID, slugFor } from "./fixtures/filter-fit";

/**
 * The results-page filter (FILTER-1, candidate) in a browser, the backend
 * stubbed (the unmocked run is tests/e2e-live/results-filter.spec.ts). Desktop
 * (the sidebar) runs in the `chromium` project, the phone's bottom sheet in
 * `mobile`; the layout switch itself is checked at 1023 and 1024 px.
 *
 * The browser is zh-TW: the filter's words are Chinese.
 */
test.use({ locale: "zh-TW" });

const FIT = buildFilterFit();
const MAIN = `/results/${FILTER_SCAN_ID}`;
const FIT_URL = `**/api/scans/${FILTER_SCAN_ID}/fit`;
const ANALYSIS_URL = `**/api/scans/${FILTER_SCAN_ID}/analysis`;

const ANALYSIS = {
  output: {
    headline: "Analysis headline",
    whyTopPick: "Analysis body about the overall first pick.",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  },
  source: "model",
  cached: false,
};

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

async function stub(page: Page) {
  const calls = { fit: 0, analysis: 0 };
  await page.route(FIT_URL, (route) => {
    calls.fit += 1;
    return json(route, FIT);
  });
  await page.route(ANALYSIS_URL, (route) => {
    calls.analysis += 1;
    return json(route, ANALYSIS);
  });
  return calls;
}

function count(query: string): number {
  return matchCount(FIT, parseFilters(query));
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

const option = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: new RegExp(`^${name}[，,]`) });

/** A brand option; the brands past the featured five are behind 「顯示其他 N 個品牌」. */
async function brand(page: Page, name: string) {
  const box = option(page, name);
  if ((await box.count()) === 0) {
    const scope = page.getByRole("dialog").or(page.locator("aside"));
    await scope.getByRole("button", { name: /^顯示其他 \d+ 個品牌$/ }).click();
  }
  return box;
}

/** The visible 「找到 N 款」 (not the visually hidden live region). */
const found = (page: Page) =>
  page.locator(".results-sidebar-count, .results-filterBar-count");

/** The state of the URL's own filter parameters. */
const search = (page: Page) => new URL(page.url()).search;

test.describe("desktop sidebar", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isDesktop(page), "Desktop layout only.");
    await stub(page);
  });

  test("shows the sidebar with only 品牌 open, counts, and no chips", async ({
    page,
  }) => {
    await page.goto(MAIN);
    const sidebar = page.getByRole("complementary", { name: "篩選" });
    await expect(sidebar).toBeVisible();
    await expect(found(page)).toHaveText(`找到 ${FIT.results.length} 款`);
    await expect(
      sidebar.getByRole("button", { name: /^品牌/ }),
    ).toHaveAttribute("aria-expanded", "true");
    for (const group of ["尺寸", "重量", "滑鼠握感", "連線方式"]) {
      const header = sidebar.getByRole("button", {
        name: new RegExp(`^${group}`),
      });
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(header).toContainText("不限");
    }
    await expect(page.getByRole("list", { name: "已套用的篩選" })).toHaveCount(
      0,
    );
    // The five featured brands first, the rest behind a link.
    await expect(
      sidebar.getByRole("button", { name: /^顯示其他 \d+ 個品牌$/ }),
    ).toBeVisible();
    // The page is the plain one: no badge, no collapsed analysis.
    await expect(page.locator(".results-badge")).toHaveCount(0);
    await expect(page.locator(".results-analysisLine")).toHaveCount(0);
  });

  test("applies on each change: URL, count, chips, large card, analysis line, share", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await option(page, "Razer").click();
    await expect(page).toHaveURL(/\?brand=Razer$/);
    // Open 連線方式 and choose 無線.
    await page.getByRole("button", { name: /^連線方式/ }).click();
    await option(page, "無線").click();
    expect(search(page)).toBe("?brand=Razer&conn=wireless");
    const n = count("brand=Razer&conn=wireless");
    await expect(found(page)).toHaveText(`找到 ${n} 款`);

    const chips = page.getByRole("list", { name: "已套用的篩選" });
    await expect(chips.getByRole("button")).toHaveCount(2);
    await expect(
      chips.getByRole("button", { name: "移除「Razer」" }),
    ).toBeVisible();

    // The filtered #1 is Viper V3 Pro, overall #3 (Zowie and Logitech are out).
    await expect(page.locator(".results-badge")).toHaveText("篩選後第 1 名");
    await expect(page.locator(".results-score-overall")).toHaveText(
      "總排名第 3 名",
    );
    await expect(page.locator(".results-score-model")).toHaveText(
      "Viper V3 Pro",
    );
    // Same shell: the matching member.
    await expect(
      page.locator(".results-score-name .results-variants"),
    ).toHaveText("相同構型：Viper V4 Pro");
    // The analysis shrinks to one line about the overall #1 and opens in place.
    const line = page.locator(".results-analysisLine");
    await expect(line).toContainText("AI 分析是針對總排名第 1 的 Zowie EC2-DW");
    await expect(page.getByText("Analysis body")).toHaveCount(0);
    await line.getByRole("button", { name: "看分析" }).click();
    await expect(
      page.getByText("Analysis body about the overall first pick."),
    ).toBeVisible();
    await line.getByRole("button", { name: "收起分析" }).click();
    await expect(page.getByText("Analysis body")).toBeHidden();
    // The share button is secondary, with its note.
    const share = page
      .locator(".results-share-hero")
      .getByTestId("share-card-button");
    await expect(share).toHaveText("分享總排名第 1 名");
    await expect(
      page.locator(".results-share-hero .shareCard-note"),
    ).toHaveText("篩選中，分享圖仍放總排名第 1 名");
    // Not the primary pill: a text link with no fill.
    await expect(share).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    // Removing a chip updates everything.
    await chips.getByRole("button", { name: "移除「無線」" }).click();
    expect(search(page)).toBe("?brand=Razer");
    await chips.getByRole("button", { name: "移除「Razer」" }).click();
    expect(search(page)).toBe("");
    await expect(page.locator(".results-badge")).toHaveCount(0);
  });

  test("overall #1 still matching changes nothing: no badge, analysis stays in Details", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await (await brand(page, "Zowie")).click();
    await expect(page.locator(".results-badge")).toHaveCount(0);
    await expect(page.locator(".results-analysisLine")).toHaveCount(0);
    await expect(page.locator(".results-score-model")).toHaveText("EC2-DW");
    await expect(page.locator(".results-score-rank")).toHaveText(
      "第 1 名 · Zowie",
    );
    // The share button is secondary all the same: the page is filtering.
    await expect(
      page.locator(".results-share-hero .shareCard-note"),
    ).toBeVisible();
    await page.locator(".results-details summary").click();
    await expect(
      page.getByText("Analysis body about the overall first pick."),
    ).toBeVisible();
  });

  test("a filter survives a reload, and a URL with none is the plain page", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Razer&size=medium`);
    await expect(page.locator(".results-badge")).toHaveText("篩選後第 1 名");
    await expect(found(page)).toHaveText(
      `找到 ${count("brand=Razer&size=medium")} 款`,
    );
    await page.reload();
    await expect(page.locator(".results-badge")).toHaveText("篩選後第 1 名");
    expect(search(page)).toBe("?brand=Razer&size=medium");
    await page.goto(MAIN);
    await expect(page.locator(".results-badge")).toHaveCount(0);
    await expect(found(page)).toHaveText(`找到 ${FIT.results.length} 款`);
  });

  test("unknown values in the URL are ignored", async ({ page }) => {
    await page.goto(
      `${MAIN}?brand=NoSuchBrand&size=huge&conn=wifi&weight=heavy&utm_source=x`,
    );
    await expect(found(page)).toHaveText(`找到 ${FIT.results.length} 款`);
    await expect(page.locator(".results-badge")).toHaveCount(0);
  });

  test("a card opened from the filtered list keeps the filter, and back returns to it", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Razer&conn=wireless`);
    const first = page.locator(".results-others .results-card").first();
    // Filtered #2 is Cobra Pro (overall #12).
    await expect(first).toContainText("Cobra Pro");
    await expect(first).toContainText("第 2 名");
    await expect(first).toContainText("總排名第 12 名");
    await first.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/m/${slugFor("Razer", "Cobra Pro")}\\?brand=Razer&conn=wireless$`,
      ),
    );
    await expect(page).toHaveTitle(/^其他推薦/);
    await expect(page.locator(".results-badge")).toHaveText("篩選後第 2 名");
    await expect(page.locator(".results-score-overall")).toHaveText(
      "總排名第 12 名",
    );
    // The detail page's other picks are the filtered list without this card.
    const cards = page.locator(".results-others .results-card");
    await expect(cards.first()).toContainText("Viper V3 Pro");
    await expect(cards.first()).toHaveAttribute(
      "href",
      `${MAIN}?brand=Razer&conn=wireless`,
    );
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${MAIN}\\?brand=Razer&conn=wireless$`),
    );
    await expect(page.locator(".results-badge")).toHaveText("篩選後第 1 名");
  });

  test("a detail page whose mouse the filter leaves out, or the filtered #1, goes to the main page with the filter", async ({
    page,
  }) => {
    await page.goto(`${MAIN}/m/${slugFor("Zowie", "EC2-DW")}?brand=Razer`);
    await expect(page).toHaveURL(new RegExp(`${MAIN}\\?brand=Razer$`));
    await page.goto(
      `${MAIN}/m/${slugFor("Razer", "Viper V3 Pro")}?brand=Razer`,
    );
    await expect(page).toHaveURL(new RegExp(`${MAIN}\\?brand=Razer$`));
  });

  test("no filter: the old detail rule holds (rank 6 and later go to the main page)", async ({
    page,
  }) => {
    await page.goto(`${MAIN}/m/${slugFor("Corsair", "Sabre RGB Pro")}`);
    await expect(page).toHaveURL(new RegExp(`${MAIN}$`));
  });

  test("no match: one sentence and a button that removes a whole group", async ({
    page,
  }) => {
    // Razer small wired: none. Dropping 尺寸 leaves Razer wired (2), dropping 連線方式 leaves Razer small (2),
    // dropping 品牌 leaves small wired (4): 品牌 wins.
    await page.goto(`${MAIN}?brand=Razer&size=small&conn=wired`);
    expect(count("brand=Razer&size=small&conn=wired")).toBe(0);
    await expect(page.getByText("目前沒有符合條件的滑鼠")).toBeVisible();
    const relax = page.getByRole("button", {
      name: /^拿掉「.+」條件，可看到 \d+ 款$/,
    });
    await expect(relax).toHaveText("拿掉「品牌」條件，可看到 4 款");
    await expect(found(page)).toHaveText("找到 0 款");
    await expect(page.locator(".results-score-model")).toHaveCount(0);
    await relax.click();
    expect(search(page)).toBe("?size=small&conn=wired");
    await expect(found(page)).toHaveText("找到 4 款");
  });

  test("one left: 「只有這 1 款符合」", async ({ page }) => {
    await page.goto(`${MAIN}?brand=Roccat&size=large`);
    expect(count("brand=Roccat&size=large")).toBe(1);
    await expect(page.getByText("只有這 1 款符合")).toBeVisible();
  });

  test("a disabled option says 0 款, stays in the Tab order and does nothing", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Roccat`);
    await page.getByRole("button", { name: /^尺寸/ }).click();
    // Roccat has no small mouse: 小型鼠 would leave nothing.
    const small = page.getByRole("checkbox", { name: "小型鼠，0 款" });
    await expect(small).toHaveAttribute("aria-disabled", "true");
    await small.focus();
    await expect(small).toBeFocused();
    await small.click({ force: true });
    expect(search(page)).toBe("?brand=Roccat");
    await expect(small).not.toBeChecked();
  });

  test("a chosen option is never disabled, even at 0", async ({ page }) => {
    await page.goto(`${MAIN}?brand=Roccat&size=small`);
    const small = page.getByRole("checkbox", { name: "小型鼠，0 款" });
    await expect(small).toBeChecked();
    await expect(small).not.toHaveAttribute("aria-disabled", "true");
  });

  test("適合你 sits on 中型鼠 only; the size note says how it is worked out", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await page.getByRole("button", { name: /^尺寸/ }).click();
    await expect(page.getByText("依長度與寬度估算")).toBeVisible();
    await expect(page.locator(".results-facet-fits")).toHaveCount(1);
    await expect(
      page.getByRole("checkbox", { name: /^中型鼠，\d+ 款，適合你$/ }),
    ).toBeVisible();
  });

  test("a group with a choice says how many mice have no data for it", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?weight=50-69`);
    await expect(
      page.getByText("另有 1 款沒有重量資料，篩選時不會列出"),
    ).toBeVisible();
  });

  test("the live region says 「找到 N 款」 once, about 300 ms after a change", async ({
    page,
  }) => {
    await page.goto(MAIN);
    const status = page.getByTestId("filter-status");
    await expect(status).toHaveText("");
    await option(page, "Razer").click();
    await expect(status).toHaveText("");
    await expect(status).toHaveText(`找到 ${count("brand=Razer")} 款`);
    await expect(
      page.locator('[role="status"]').filter({ hasText: "找到" }),
    ).toHaveCount(1);
  });

  test("excluded mice are hidden while filtering, with a note", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Razer`);
    await expect(
      page.getByText(
        `篩選中，未列入比較的 ${FIT.excluded.length} 款不會列出。`,
      ),
    ).toBeVisible();
    await page.goto(MAIN);
    await page.locator(".results-otherMice summary").click();
    await expect(
      page.locator(".results-excluded-list li").first(),
    ).toBeVisible();
  });

  test("the sidebar is sticky and scrolls inside itself", async ({ page }) => {
    await page.goto(MAIN);
    const sidebar = page.getByRole("complementary", { name: "篩選" });
    const before = await sidebar.boundingBox();
    // Part-way down the page the sidebar stays in view, 1rem from the top (it
    // only leaves with the end of its own container, at the foot of the page).
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(200);
    const after = await sidebar.boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThanOrEqual(before!.y);
    expect(after!.y).toBeLessThanOrEqual(20);
    const overflow = await sidebar.evaluate(
      (el) => getComputedStyle(el).overflowY,
    );
    expect(overflow).toBe("auto");
  });

  test("print hides the filter", async ({ page }) => {
    await page.goto(`${MAIN}?brand=Razer`);
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("complementary", { name: "篩選" }),
    ).toBeHidden();
  });

  test("the primary button of the rest of the page is untouched, the filter's pills are compact", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Razer&size=small&conn=wired`);
    const relax = page.getByRole("button", { name: /^拿掉「/ });
    const box = await relax.boundingBox();
    expect(Math.round(box!.height)).toBe(40);
    await expect(relax).toHaveCSS("font-size", "15px");
    await expect(relax).toHaveCSS("padding-left", "24px");
  });
});

test.describe("phone sheet", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isDesktop(page), "Phone layout only.");
    await stub(page);
  });

  const trigger = (page: Page) => page.getByRole("button", { name: /^篩選/ });
  const sheet = (page: Page) => page.getByRole("dialog", { name: "篩選" });

  test("the results page has 篩選, the count and no sidebar", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await expect(trigger(page)).toHaveText("篩選");
    await expect(found(page)).toHaveText(`找到 ${FIT.results.length} 款`);
    await expect(page.getByRole("complementary", { name: "篩選" })).toHaveCount(
      0,
    );
    await expect(sheet(page)).toHaveCount(0);
  });

  test("opens as a modal dialog with focus on its title; applies with 「查看 N 款滑鼠」; focus goes back", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(
      sheet(page).getByRole("heading", { name: "篩選" }),
    ).toBeFocused();
    await expect(
      sheet(page).evaluate((el) => (el as HTMLDialogElement).matches(":modal")),
    ).resolves.toBe(true);
    await option(page, "Razer").click();
    const n = count("brand=Razer");
    const apply = sheet(page).getByRole("button", { name: `查看 ${n} 款滑鼠` });
    await expect(apply).toBeVisible();
    // Nothing is applied yet.
    expect(search(page)).toBe("");
    await apply.click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\?brand=Razer$/);
    await expect(trigger(page)).toHaveText("篩選（1）");
    await expect(trigger(page)).toBeFocused();
    await expect(found(page)).toHaveText(`找到 ${n} 款`);
    await expect(
      page.getByRole("list", { name: "已套用的篩選" }).getByRole("button", {
        name: "移除「Razer」",
      }),
    ).toBeVisible();
  });

  test("✕ discards the draft and returns focus to 篩選", async ({ page }) => {
    await page.goto(`${MAIN}?brand=Razer`);
    await trigger(page).click();
    await option(page, "Logitech").click();
    await expect(option(page, "Logitech")).toBeChecked();
    await sheet(page).getByRole("button", { name: "關閉篩選" }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(search(page)).toBe("?brand=Razer");
    await expect(trigger(page)).toBeFocused();
    // Opening again starts from what is applied.
    await trigger(page).click();
    await expect(option(page, "Razer")).toBeChecked();
  });

  test("Esc discards the draft", async ({ page }) => {
    await page.goto(MAIN);
    await trigger(page).click();
    await option(page, "Razer").click();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    expect(search(page)).toBe("");
    await expect(trigger(page)).toHaveText("篩選");
    await expect(trigger(page)).toBeFocused();
  });

  test("dragging the handle down discards it too; a short drag springs back", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await trigger(page).click();
    await option(page, "Razer").click();
    const handle = sheet(page).locator(".results-sheet-handle");
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // A short drag: back where it was.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40, { steps: 4 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
    // A long one: gone, nothing applied.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 420, { steps: 8 });
    await page.mouse.up();
    await expect(sheet(page)).toHaveCount(0);
    expect(search(page)).toBe("");
    await expect(trigger(page)).toBeFocused();
  });

  test("with reduced motion nothing slides: it closes at once", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(MAIN);
    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();
    const animation = await sheet(page).evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    expect(animation).toBe("none");
    await sheet(page).getByRole("button", { name: "關閉篩選" }).click();
    await expect(sheet(page)).toHaveCount(0, { timeout: 100 });
  });

  test("the footer clears the draft only; the page keeps its filter until applied", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Razer&conn=wireless`);
    await trigger(page).click();
    await sheet(page).getByRole("button", { name: "清除全部" }).click();
    await expect(
      sheet(page).getByRole("button", {
        name: `查看 ${FIT.results.length} 款滑鼠`,
      }),
    ).toBeVisible();
    expect(search(page)).toBe("?brand=Razer&conn=wireless");
    await sheet(page)
      .getByRole("button", { name: `查看 ${FIT.results.length} 款滑鼠` })
      .click();
    expect(search(page)).toBe("");
  });

  test("the sheet's footer button is compact: 44 px tall, 15 px label", async ({
    page,
  }) => {
    await page.goto(MAIN);
    await trigger(page).click();
    const apply = sheet(page).getByRole("button", {
      name: /^查看 \d+ 款滑鼠$/,
    });
    const box = await apply.boundingBox();
    expect(Math.round(box!.height)).toBe(44);
    await expect(apply).toHaveCSS("font-size", "15px");
    await expect(apply).toHaveCSS("padding-left", "24px");
    await expect(apply).toHaveCSS("padding-right", "24px");
  });

  test("a mobile page has no horizontal scroll with the filter on", async ({
    page,
  }) => {
    await page.goto(`${MAIN}?brand=Razer&conn=wireless&size=medium`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("the layout switch", () => {
  test("1023 px gets the sheet, 1024 px the sidebar", async ({ page }) => {
    test.skip(!isDesktop(page), "Resizes the desktop window.");
    await stub(page);
    await page.setViewportSize({ width: 1023, height: 800 });
    await page.goto(MAIN);
    await expect(page.getByRole("button", { name: /^篩選/ })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "篩選" })).toHaveCount(
      0,
    );
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(
      page.getByRole("complementary", { name: "篩選" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^篩選/ })).toHaveCount(0);
  });

  test("a filter set in one layout shows in the other", async ({ page }) => {
    test.skip(!isDesktop(page), "Resizes the desktop window.");
    await stub(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(MAIN);
    await option(page, "Razer").click();
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.getByRole("button", { name: "篩選（1）" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "移除「Razer」" }),
    ).toBeVisible();
  });
});

test("the filter's pure view agrees with the page: the large card is the filtered #1", async ({
  page,
}) => {
  await stub(page);
  const query = "brand=Razer&conn=wired";
  const view = filteredView(FIT, parseFilters(query));
  await page.goto(`${MAIN}?${query}`);
  await expect(page.locator(".results-score-model")).toHaveText(
    view.large!.entry.mouse.model,
  );
  expect(filteredView(FIT, emptyFilters()).large!.entry.rank).toBe(1);
});

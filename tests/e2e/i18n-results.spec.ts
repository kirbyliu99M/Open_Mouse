import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { LOCALE_COOKIE } from "../../src/lib/contracts/locale";

/**
 * The results experience in zh-TW: the demo page, a mocked real results page
 * (loading, ready, analysis, delete dialog, 404), and the written analysis
 * following a language switch. English stays the negative control.
 */
const fixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/many-results.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
);

const SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const FIT_URL = `**/api/scans/${SCAN_ID}/fit`;
const ANALYSIS_URL = `**/api/scans/${SCAN_ID}/analysis`;
const SCAN_URL = `**/api/scans/${SCAN_ID}`;

function analysisBody(headline: string, why: string) {
  return {
    output: {
      headline,
      whyTopPick: why,
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    },
    source: "model",
    cached: false,
  };
}

const ZH_ANALYSIS = analysisBody("很適合趴握", "長度與握寬都接近你的理想值");
const EN_ANALYSIS = analysisBody(
  "A close match for your palm grip",
  "Length and grip width are both near your ideal",
);

const LINKS = {
  officialUrl: "https://www.logitechg.com/example",
  officialKind: "product",
  purchaseLinks: [{ label: "Pchome 24h", url: "https://24h.pchome.com.tw/x" }],
};

/** The fixture with a real committed photo on the top mouse. */
function withTopPhoto(base: unknown): unknown {
  const copy = structuredClone(base) as {
    results: { mouse: Record<string, unknown> }[];
  };
  copy.results[0].mouse.imageUrl =
    "/images/mice/logitech-g-pro-x-superlight-2.webp";
  return copy;
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function setLocale(
  context: BrowserContext,
  baseURL: string | undefined,
  value: "zh-TW" | "en",
) {
  await context.addCookies([
    { name: LOCALE_COOKIE, value, url: baseURL ?? "http://localhost:3000" },
  ]);
}

async function openDetails(page: Page) {
  const details = page.locator(".results-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

test.describe("results in zh-TW", () => {
  test.use({ locale: "zh-TW" });

  test("/results/demo shows the zh-TW words", async ({ page }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    await expect(page.locator(".results-why-heading")).toHaveText(
      "為什麼是這支",
    );
    await expect(page.locator(".results-details summary")).toContainText(
      "詳細資料",
    );
    await page.locator(".results-details summary").click();
    await expect(page.getByRole("heading", { name: "六項分數" })).toBeVisible();
    await expect(page.getByText("握寬", { exact: true }).first()).toBeVisible();
    const shareTexts = await page
      .getByTestId("share-card-button")
      .allTextContents();
    expect(shareTexts).toContain("製作我的分享圖");
    // Written-analysis states, in the demo's own switcher.
    await page.getByRole("button", { name: "Loading" }).click();
    await expect(page.getByText("正在準備你的文字分析…")).toBeVisible();
    await page.getByRole("button", { name: "Error", exact: true }).click();
    await expect(page.getByRole("button", { name: "再試一次" })).toBeVisible();
    await page
      .getByRole("button", { name: "Ready (written from scores)" })
      .click();
    await expect(page.getByText("依上方的分數自動產生。")).toBeVisible();
    await expect(page.getByText("為什麼推薦這支")).toBeVisible();
  });

  test("a mocked real results page: ready, filter, share, delete dialog", async ({
    page,
    context,
    baseURL,
  }) => {
    await setLocale(context, baseURL, "zh-TW");
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 200, withTopPhoto(fixture)),
    );
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, ZH_ANALYSIS),
    );
    await page.route("**/api/mice/*/links", (route) =>
      fulfillJson(route, 200, LINKS),
    );
    await page.route(SCAN_URL, (route) => route.fulfill({ status: 204 }));
    await page.goto(`/results/${SCAN_ID}`);

    // Photo alt (the mouse's own name), official link, purchase list.
    await expect(
      page.getByRole("img", { name: "Logitech G Pro X Superlight 2" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Logitech 官網產品頁/ }),
    ).toContainText("（開新分頁）");
    await expect(
      page.getByRole("heading", { level: 2, name: "購買" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Pchome 24h/ }).first(),
    ).toContainText("（開新分頁）");

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    await expect(page).toHaveTitle(/^你的結果/);
    await expect(
      page.getByRole("heading", { level: 2, name: "為什麼是這支" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("篩選", { exact: true }).first(),
    ).toBeAttached();
    const shareTexts = await page
      .getByTestId("share-card-button")
      .allTextContents();
    expect(shareTexts).toContain("製作我的分享圖");

    await openDetails(page);
    await expect(page.getByText("很適合趴握")).toBeVisible();
    // Model-written text: small label and the visible AI notice, in zh-TW.
    await expect(page.locator(".results-analysis-labelRow")).toContainText(
      "文字分析",
    );
    await expect(page.locator(".results-analysis-aiNotice")).toHaveText(
      "本分析由 AI 撰寫，內容僅供參考。",
    );
    await expect(
      page.getByRole("heading", { name: "為什麼推薦這支" }),
    ).toBeVisible();
    await expect(
      page.getByText("你的理想尺寸與這支滑鼠的比較（mm）"),
    ).toBeVisible();

    const trigger = page.getByRole("button", { name: "立即刪除這次掃描" });
    await trigger.click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("heading", { name: "要立即刪除這次掃描嗎？" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    await dialog.getByRole("button", { name: "刪除掃描" }).click();
    const heading = page.getByRole("heading", { name: "這次掃描已刪除" });
    await expect(heading).toBeFocused();
    await expect(page.getByText("你的測量資料已永久移除。")).toBeVisible();
  });

  test("404 on the fit route shows the zh-TW error screen", async ({
    page,
    context,
    baseURL,
  }) => {
    await setLocale(context, baseURL, "zh-TW");
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 404, { error: "Scan not found" }),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(
      page.getByRole("heading", { name: "找不到這次掃描" }),
    ).toBeVisible();
    await expect(
      page.locator(".results-page-error").getByRole("link", {
        name: "重新掃描",
        exact: true,
      }),
    ).toHaveAttribute("href", "/scan/easy");
  });

  test("the written analysis follows a language switch, and a late old response cannot overwrite it", async ({
    page,
    context,
    baseURL,
  }) => {
    await setLocale(context, baseURL, "zh-TW");
    await page.route(FIT_URL, (route) => fulfillJson(route, 200, fixture));

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    await page.route(ANALYSIS_URL, async (route) => {
      const cookie = (await route.request().allHeaders())["cookie"] ?? "";
      const zh = cookie.includes(`${LOCALE_COOKIE}=zh-TW`);
      seen.push(zh ? "zh-TW" : "en");
      if (zh) {
        // The first answer is slow: it arrives after the switch.
        await gate;
        await fulfillJson(route, 200, ZH_ANALYSIS);
      } else {
        await fulfillJson(route, 200, EN_ANALYSIS);
      }
    });

    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);
    await expect(page.getByText("正在準備你的文字分析…")).toBeVisible();

    await page
      .getByTestId("language-switcher")
      .first()
      .getByRole("button", { name: "English" })
      .click();

    await expect(
      page.getByText("A close match for your palm grip"),
    ).toBeVisible();
    expect(seen).toEqual(["zh-TW", "en"]);
    // The label and the AI notice switch language with the text.
    await expect(page.locator(".results-analysis-labelRow")).toContainText(
      "Written analysis",
    );
    await expect(page.locator(".results-analysis-aiNotice")).toHaveText(
      "This analysis was written by AI and is for reference only.",
    );

    // The slow zh-TW answer lands now; it must not replace the English one.
    release();
    await page.waitForTimeout(500);
    await expect(
      page.getByText("A close match for your palm grip"),
    ).toBeVisible();
    await expect(page.getByText("很適合趴握")).toHaveCount(0);

    // Switching back asks again (loading first, then the zh-TW text).
    await page
      .getByTestId("language-switcher")
      .first()
      .getByRole("button", { name: "中文" })
      .click();
    await expect(page.getByText("很適合趴握")).toBeVisible();
    await expect(page.locator(".results-analysis-aiNotice")).toHaveText(
      "本分析由 AI 撰寫，內容僅供參考。",
    );
    expect(seen).toEqual(["zh-TW", "en", "zh-TW"]);
  });
});

test.describe("negative control: English", () => {
  test.use({ locale: "en-US" });

  test("the same pages stay in English", async ({ page, context, baseURL }) => {
    await setLocale(context, baseURL, "en");
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 200, withTopPhoto(fixture)),
    );
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, EN_ANALYSIS),
    );
    await page.route("**/api/mice/*/links", (route) =>
      fulfillJson(route, 200, LINKS),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/^Your results/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Why this mouse" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete this scan now" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Logitech official product page/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Buy" }),
    ).toBeVisible();
    expect(await page.getByRole("main").innerText()).not.toMatch(/[㐀-鿿]/);
  });
});

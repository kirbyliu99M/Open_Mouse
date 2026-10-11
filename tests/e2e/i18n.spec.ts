import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "../../src/lib/contracts/locale";
import {
  en as footerEn,
  zhTW as footerZh,
} from "../../src/lib/copy/site-footer";
import { en as navEn, zhTW as navZh } from "../../src/lib/copy/nav";

/**
 * The server renders in the visitor's locale: cookie first, then
 * Accept-Language, then zh-TW. The URL never carries the language.
 */

const LANG_OF_HTML = /<html[^>]*\blang="([^"]+)"/;

async function serverLang(
  page: Page,
  headers: Record<string, string>,
): Promise<string | undefined> {
  const res = await page.request.get("/", { headers });
  expect(res.ok()).toBe(true);
  return LANG_OF_HTML.exec(await res.text())?.[1];
}

test.describe("server-rendered <html lang>", () => {
  test("follows Accept-Language", async ({ page }) => {
    expect(await serverLang(page, { "Accept-Language": "zh-TW" })).toBe(
      "zh-TW",
    );
    expect(await serverLang(page, { "Accept-Language": "en-US" })).toBe("en");
  });

  test("falls back to zh-TW with no header, or an unsupported one", async ({
    page,
  }) => {
    expect(await serverLang(page, { "Accept-Language": "" })).toBe("zh-TW");
    expect(await serverLang(page, { "Accept-Language": "ja" })).toBe("zh-TW");
  });

  test("the cookie overrides the header, and a junk cookie does not", async ({
    page,
  }) => {
    expect(
      await serverLang(page, {
        "Accept-Language": "zh-TW",
        Cookie: `${LOCALE_COOKIE}=en`,
      }),
    ).toBe("en");
    expect(
      await serverLang(page, {
        "Accept-Language": "en-US",
        Cookie: `${LOCALE_COOKIE}=zh-TW`,
      }),
    ).toBe("zh-TW");
    // Negative control: a value that is not a locale is ignored.
    expect(
      await serverLang(page, {
        "Accept-Language": "en-US",
        Cookie: `${LOCALE_COOKIE}=fr`,
      }),
    ).toBe("en");
  });

  test("the home annotations are in the locale's language", async ({
    page,
  }) => {
    const zh = await page.request.get("/", {
      headers: { "Accept-Language": "zh-TW" },
    });
    expect(await zh.text()).toContain("掌寬");
    const en = await page.request.get("/", {
      headers: { "Accept-Language": "en-US" },
    });
    const html = await en.text();
    expect(html).toContain("Palm width");
    expect(html).not.toContain("掌寬");
  });
});

test.describe("switching language, from a zh-TW browser", () => {
  test.use({ locale: "zh-TW" });

  function watchConsole(page: Page): string[] {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || /hydrat/i.test(m.text()))
        problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));
    return problems;
  }

  test("the footer switcher changes the page, sets the cookie, and persists", async ({
    page,
    context,
  }) => {
    const problems = watchConsole(page);
    await page.goto("/how-it-works");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    const footer = page.getByTestId("site-footer");
    await expect(footer).toContainText(footerZh.groupProduct);

    const switcher = footer.getByTestId("language-switcher");
    await expect(
      switcher.getByRole("button", { name: "中文" }),
    ).toHaveAttribute("aria-pressed", "true");
    await switcher.getByRole("button", { name: "English" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(footer).toContainText(footerEn.groupProduct);
    await expect(footer).not.toContainText(footerZh.groupProduct);
    await expect(
      switcher.getByRole("button", { name: "English" }),
    ).toHaveAttribute("aria-pressed", "true");
    const cookie = (await context.cookies()).find(
      (c) => c.name === LOCALE_COOKIE,
    );
    expect(cookie?.value).toBe("en");
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");

    // Persists across a reload and a navigation, with the browser still zh-TW.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(footer).toContainText(footerEn.groupProduct);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Find the mouse that fits.",
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("without a click, a zh-TW browser stays zh-TW (negative control)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    await expect(page.getByTestId("site-footer")).toContainText(
      footerZh.groupProduct,
    );
  });

  test("the home menu has a switcher that works", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/");
    await page.getByRole("button", { name: navZh.menuOpen }).click();
    const dialog = page.getByRole("dialog", { name: navZh.menuDialogLabel });
    await expect(dialog).toContainText(navZh.scanMyHand);
    await dialog.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // The menu stays open and is now in English.
    await expect(
      page.getByRole("dialog", { name: navEn.menuDialogLabel }),
    ).toContainText(navEn.scanMyHand);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("the switcher is reachable and usable from the keyboard, with 44 px targets", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const english = page
      .getByTestId("site-footer")
      .getByRole("button", { name: "English" });
    const box = await english.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await english.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

import { expect, test } from "@playwright/test";

const STATEMENT =
  "Not affiliated with Logitech. Sizes from Logitech's published specs.";

test.describe("the site footer, in English", () => {
  for (const path of ["/", "/how-it-works", "/account"]) {
    test(`${path} has the footer: name, preview note, four links, the statement once`, async ({
      page,
    }) => {
      await page.goto(path);
      const footer = page.getByTestId("site-footer");
      await expect(footer).toBeVisible();
      await expect(footer.getByText("Palmate", { exact: true })).toBeVisible();
      await expect(footer).toContainText(
        "Early preview · measurements are still being validated",
      );
      const links = footer.getByRole("navigation", { name: "Site links" });
      await expect(
        links.getByRole("link", { name: "How it works" }),
      ).toHaveAttribute("href", "/how-it-works");
      await expect(
        links.getByRole("link", { name: "Privacy" }),
      ).toHaveAttribute("href", "/how-it-works#privacy");
      await expect(
        links.getByRole("link", { name: "Account" }),
      ).toHaveAttribute("href", "/account");
      await expect(links.getByRole("link", { name: "GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/kirbyliu99M/Open_Mouse",
      );
      // Shown once on the page, not once in the footer and once in the page.
      await expect(page.getByText(STATEMENT)).toHaveCount(1);
      await expect(footer.getByText(STATEMENT)).toHaveCount(1);
      // English is the page's own language: nothing is marked zh-TW.
      await expect(footer.locator('[lang="zh-TW"]')).toHaveCount(0);
    });
  }

  test("the Privacy link lands on the privacy card", async ({ page }) => {
    await page.goto("/");
    await page
      .getByTestId("site-footer")
      .getByRole("link", { name: "Privacy" })
      .click();
    await expect(page).toHaveURL(/\/how-it-works#privacy$/);
    await expect(page.locator("#privacy")).toBeVisible();
  });

  test("the footer is below the content and the page does not scroll sideways", async ({
    page,
  }) => {
    for (const size of [
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/how-it-works");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const [mainBottom, footerTop] = await page.evaluate(() => [
        document.querySelector("main")!.getBoundingClientRect().bottom,
        document
          .querySelector('[data-testid="site-footer"]')!
          .getBoundingClientRect().top,
      ]);
      expect(footerTop).toBeGreaterThanOrEqual(mainBottom);
    }
  });

  test("a link shows a focus ring from the keyboard", async ({ page }) => {
    await page.goto("/how-it-works");
    const link = page
      .getByTestId("site-footer")
      .getByRole("link", { name: "Account" });
    await link.focus();
    expect(
      await link.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
  });
});

test.describe("the site footer, for a browser that prefers Chinese", () => {
  test.use({ locale: "zh-TW" });

  test("switches to zh-TW after mount and marks that text lang=zh-TW", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const footer = page.getByTestId("site-footer");
    await expect(footer.getByRole("link", { name: "運作方式" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "隱私" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "帳號" })).toBeVisible();
    await expect(footer).toContainText("Early preview · 量測仍在驗證中");
    await expect(footer.locator('[lang="zh-TW"]')).not.toHaveCount(0);
    // The statement is not translated yet (Kirby is writing it): English, unmarked.
    const statement = footer.getByText(STATEMENT);
    await expect(statement).toHaveCount(1);
    expect(await statement.getAttribute("lang")).toBeNull();
    // No hydration complaint.
  });
});

test.describe("pages with their own print layout have no footer", () => {
  for (const path of [
    "/learn/print",
    "/learn/slates",
    "/sheet",
    "/scan/easy",
  ]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.getByTestId("site-footer")).toHaveCount(0);
      await page.emulateMedia({ media: "print" });
      await expect(page.getByTestId("site-footer")).toHaveCount(0);
    });
  }
});

test("on paper the footer prints dark text on white", async ({ page }) => {
  await page.goto("/how-it-works");
  await page.emulateMedia({ media: "print" });
  const colours = await page.evaluate(() =>
    [
      ".siteFooter-name",
      ".siteFooter-preview",
      ".siteFooter-links a",
      ".siteFooter-statement",
    ].map((selector) => {
      const el = document.querySelector(selector)!;
      return [selector, getComputedStyle(el).color] as const;
    }),
  );
  for (const [selector, colour] of colours) {
    const [r, g, b] = colour.match(/\d+/g)!.map(Number) as [
      number,
      number,
      number,
    ];
    expect(r + g + b, `${selector} ${colour}`).toBeLessThan(3 * 128);
  }
  const bg = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector(".siteFooter")!).backgroundColor,
  );
  expect(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]).toContain(bg);
});

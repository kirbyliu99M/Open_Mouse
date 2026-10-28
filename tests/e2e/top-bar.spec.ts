import { expect, test } from "@playwright/test";

/**
 * Item 5: the chevron and label render with a visible gap ("‹ Scan again",
 * not "‹Scan again"), and the link's accessible name is the destination
 * alone — the decorative chevron never leaks into it.
 */
test.describe("TopBar — chevron spacing and accessible name", () => {
  test("/scan's back link has a non-zero visual gap and an accessible name without the chevron", async ({
    page,
  }) => {
    await page.goto("/scan");
    const backLink = page.getByRole("link", { name: /sheet/i }).first();
    await expect(backLink).toHaveAccessibleName("Back to Sheet");

    const gap = await backLink.evaluate(
      (el) => getComputedStyle(el).columnGap || getComputedStyle(el).gap,
    );
    expect(gap).not.toBe("0px");
    expect(gap).not.toBe("");
    expect(gap).not.toBe("normal");
  });

  // 2026-10-26 (candidate / 未拍板): the results top bar is the landing
  // page's nav, the mark and Palmate on the left and the menu on the right;
  // 重新掃描 moved to the end of the page.
  test("/results/demo's top bar: the mark and Palmate (home) left, the menu right, Scan again at the end", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    const bar = page.locator(".results-topBar");
    const brand = bar.getByRole("link", { name: "Palmate", exact: true });
    await expect(brand).toHaveAttribute("href", "/");
    await expect(bar.locator(".brandLockup-mark")).toBeVisible();
    const menu = bar.getByRole("button", { name: "Open menu" });
    await expect(menu).toBeVisible();
    const brandBox = (await brand.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(brandBox.x).toBeLessThan(menuBox.x);
    await expect(bar.getByText("Scan again")).toHaveCount(0);

    const rescan = page.locator(".results-rescan-link");
    await expect(rescan).toHaveAccessibleName("Scan again");
    await expect(rescan).toHaveAttribute("href", "/scan/easy");
  });
});

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

  test("/results/demo's back link has spacing, an accessible name, and the easy-scan destination", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    const backLink = page.getByRole("link", { name: /scan again/i }).first();
    await expect(backLink).toHaveAccessibleName("Back to Scan again");
    await expect(backLink).toHaveAttribute("href", "/scan/easy");

    const gap = await backLink.evaluate(
      (el) => getComputedStyle(el).columnGap || getComputedStyle(el).gap,
    );
    expect(gap).not.toBe("0px");
    expect(gap).not.toBe("");
    expect(gap).not.toBe("normal");
  });
});

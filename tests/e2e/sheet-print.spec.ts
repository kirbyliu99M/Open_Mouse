import { expect, test } from "@playwright/test";

const MM_PER_INCH = 25.4;
const CSS_PX_PER_INCH = 96;
const EXPECTED_SHEET_WIDTH_PX = (210 * CSS_PX_PER_INCH) / MM_PER_INCH;

/**
 * Count PDF page objects — dictionaries with `/Type /Page` — not the
 * singular page-tree root, which is `/Type /Pages` (plural); the negative
 * lookahead excludes that. Verified against a real render from this app
 * (Chromium's Skia/PDF backend): these object headers are plain ASCII in
 * the file, not hidden inside a compressed object stream (`/Type /ObjStm`),
 * so a raw byte scan is a reliable way to count pages for this producer.
 */
function countPdfPageObjects(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

test.describe("printable calibration sheet (/sheet)", () => {
  test("prints as exactly one A4 page", async ({ page }) => {
    await page.goto("/sheet");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(countPdfPageObjects(pdf)).toBe(1);
  });

  test("prints as exactly one US Letter page", async ({ page }) => {
    await page.goto("/sheet");
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(countPdfPageObjects(pdf)).toBe(1);
  });

  test("the sheet SVG prints at exactly 210 mm wide", async ({ page }) => {
    await page.goto("/sheet");
    await page.emulateMedia({ media: "print" });
    const box = await page.locator(".printPage svg").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.width ?? 0) - EXPECTED_SHEET_WIDTH_PX)).toBeLessThan(
      1,
    );
  });

  test("under print media the page is white with black text, whatever the screen theme", async ({
    page,
  }) => {
    await page.goto("/sheet");
    // Screen: the one dark theme.
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    ).toBe("rgb(6, 7, 9)");
    // Print: a white root, so the bottom of an A4 page is not dark when
    // "background graphics" is on, and black text.
    await page.emulateMedia({ media: "print" });
    const print = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      text: getComputedStyle(document.body).color,
      h1: getComputedStyle(document.querySelector("h1")!).color,
    }));
    expect(print.root).toBe("rgb(255, 255, 255)");
    expect(print.text).toBe("rgb(0, 0, 0)");
    expect(print.h1).toBe("rgb(0, 0, 0)");
  });

  test("the complete screen preview fits a phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sheet");
    const box = await page.locator(".printPage svg").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page
      .getByRole("link", { name: "I've printed it — continue" })
      .click();
    await expect(page).toHaveURL(/\/scan$/);
  });
});

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

  test("the sheet SVG renders at exactly 210 mm wide — nothing rescales it", async ({
    page,
  }) => {
    await page.goto("/sheet");
    const box = await page.locator(".printPage svg").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.width ?? 0) - EXPECTED_SHEET_WIDTH_PX)).toBeLessThan(
      1,
    );
  });
});

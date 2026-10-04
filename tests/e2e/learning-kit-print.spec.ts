/**
 * Kit v2 print check, on the real route in a real browser: each sheet and the
 * participant cards go through Chromium's PDF printer (A4, the page's own CSS
 * size, background on) and what comes out is measured in PDF coordinates:
 * the page count, where the markers sit, and that the drawn 100 mm (sheet A) or
 * 180 mm (sheet B) check distance measures exactly that on paper.
 *
 * The PDFs are also kept for a person to print and hold a ruler against:
 * set `KIT_V2_PDF_DIR` to a folder (outside the repo) to write them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readPdfGeometry, type PdfGeometry } from "./helpers/pdf-geometry";

/** The printer's own tolerance for a drawn length: 20 microns. */
const LENGTH_TOLERANCE_MM = 0.02;
/** Chromium's A4 page is 595.92 x 842.88 pt, a few tenths of a mm over true A4. */
const A4_TOLERANCE_MM = 0.5;

function onlyInChromium(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "chromium",
    "device-independent: run once, in the desktop project",
  );
}

async function printToPdf(
  page: Page,
  url: string,
  name: string,
): Promise<{ pdf: Buffer; geometry: PdfGeometry }> {
  await page.goto(url);
  await expect(page.locator(".learn-print-page svg").first()).toBeVisible();
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  const dir = process.env.KIT_V2_PDF_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.pdf`), pdf);
  }
  return { pdf, geometry: readPdfGeometry(pdf) };
}

/** The black marker squares: 25 mm, filled black (the page background and clips are bigger). */
function markers(geometry: PdfGeometry) {
  return geometry.rects.filter(
    (r) =>
      Math.abs(r.w - 25) < 0.05 &&
      Math.abs(r.h - 25) < 0.05 &&
      r.fill.every((c) => c === 0),
  );
}

/**
 * The lowest edge of any text in the page's SVG, in sheet mm (user units).
 * The PDF reader skips text (it is glyphs, not paths), so this asks the
 * browser for each text element's box instead.
 */
async function textBottomMm(page: Page): Promise<number> {
  return page.evaluate(() => {
    const svg = document.querySelector(".learn-print-page svg");
    if (!svg) throw new Error("no sheet svg");
    return Math.max(
      ...[...svg.querySelectorAll("text")].map((t) => {
        const b = (t as unknown as SVGGraphicsElement).getBBox();
        return b.y + b.height;
      }),
    );
  });
}

/** Everything drawn except the page-sized background. */
function drawnBottoms(geometry: PdfGeometry): number[] {
  return [
    ...geometry.rects
      .filter((r) => r.w < 200 && r.h < 290)
      .map((r) => r.y + r.h),
    ...geometry.lines.flatMap((l) => [l.y1, l.y2]),
  ];
}

test.describe("kit v2 printing", () => {
  test("sheet A prints as exactly one A4 page, with the product's markers and a 100 mm ruler", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const { geometry } = await printToPdf(
      page,
      "/learn/print?sheet=A",
      "sheet-A",
    );
    expect(geometry.pageCount).toBe(1);
    expect(Math.abs(geometry.pageMm.width - 210)).toBeLessThan(A4_TOLERANCE_MM);
    expect(Math.abs(geometry.pageMm.height - 297)).toBeLessThan(
      A4_TOLERANCE_MM,
    );

    // Four markers, 25 mm, in the product sheet's positions relative to each other.
    const found = markers(geometry);
    expect(found).toHaveLength(4);
    const left = Math.min(...found.map((m) => m.x));
    const top = Math.min(...found.map((m) => m.y));
    const rel = found
      .map((m) => [m.x - left, m.y - top])
      .sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);
    // Product sheet: columns 15 and 170 mm, rows 67 and 222 mm (top-left corners).
    const expected = [
      [0, 0],
      [155, 0],
      [0, 155],
      [155, 155],
    ];
    rel.forEach(([x, y], i) => {
      expect(Math.abs(x! - expected[i]![0]!)).toBeLessThan(0.02);
      expect(Math.abs(y! - expected[i]![1]!)).toBeLessThan(0.02);
    });

    // The 100 mm ruler: its long line is the only 100 mm horizontal line.
    const ruler = geometry.lines.filter(
      (l) => Math.abs(l.y1 - l.y2) < 1e-6 && l.length > 90,
    );
    expect(ruler).toHaveLength(1);
    expect(Math.abs(ruler[0]!.length - 100)).toBeLessThan(LENGTH_TOLERANCE_MM);
    console.log(
      `sheet A: 100 mm ruler measures ${ruler[0]!.length.toFixed(4)} mm in the PDF`,
    );

    // Nothing is drawn below y = 282 mm.
    expect(Math.max(...drawnBottoms(geometry))).toBeLessThanOrEqual(282.05);
    // And the text, whose boxes the browser knows.
    expect(await textBottomMm(page)).toBeLessThanOrEqual(282);
  });

  test("sheet B prints as exactly one A4 page, with six markers and a 180 mm marker-to-marker distance", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const { geometry } = await printToPdf(
      page,
      "/learn/print?sheet=B",
      "sheet-B",
    );
    expect(geometry.pageCount).toBe(1);
    expect(Math.abs(geometry.pageMm.width - 210)).toBeLessThan(A4_TOLERANCE_MM);
    expect(Math.abs(geometry.pageMm.height - 297)).toBeLessThan(
      A4_TOLERANCE_MM,
    );

    const found = markers(geometry);
    expect(found).toHaveLength(6);
    const topRow = found.filter((m) => m.y < 100);
    expect(topRow).toHaveLength(2);
    // Outer edge of marker 0 to outer edge of marker 1.
    const outer =
      Math.max(...topRow.map((m) => m.x + m.w)) -
      Math.min(...topRow.map((m) => m.x));
    expect(Math.abs(outer - 180)).toBeLessThan(LENGTH_TOLERANCE_MM);
    // The same distance the drawn end ticks show.
    const ticks = geometry.lines
      .filter(
        (l) => Math.abs(l.x1 - l.x2) < 1e-6 && Math.abs(l.length - 6) < 0.05,
      )
      .filter((l) => Math.min(l.y1, l.y2) > 40 && Math.max(l.y1, l.y2) < 48);
    expect(ticks).toHaveLength(2);
    const drawn = Math.abs(ticks[0]!.x1 - ticks[1]!.x1);
    expect(Math.abs(drawn - 180)).toBeLessThan(LENGTH_TOLERANCE_MM);
    console.log(
      `sheet B: outer edge to outer edge of the top markers measures ${outer.toFixed(4)} mm, the drawn ticks ${drawn.toFixed(4)} mm`,
    );

    // The bottom row (ids 3, 4, 5, 2) sits at the same height, level with each other.
    const bottomRow = found.filter((m) => m.y > 200);
    expect(bottomRow).toHaveLength(4);
    expect(new Set(bottomRow.map((m) => m.y.toFixed(2))).size).toBe(1);
    expect(Math.max(...drawnBottoms(geometry))).toBeLessThanOrEqual(282.05);
    expect(await textBottomMm(page)).toBeLessThanOrEqual(282);
  });

  test("12 participant cards (P901 to P912) print as one A4 page, 48 (P001 to P048) as two", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const s0 = await printToPdf(
      page,
      "/learn/slates?kit=2&from=901&count=12",
      "cards-P901-P912",
    );
    expect(s0.geometry.pageCount).toBe(1);
    expect(await textBottomMm(page)).toBeLessThanOrEqual(282);
    await expect(page.locator(".learn-print-page svg")).toHaveCount(1);
    expect(Math.max(...drawnBottoms(s0.geometry))).toBeLessThanOrEqual(282.05);

    const main = await printToPdf(
      page,
      "/learn/slates?kit=2&from=1&count=48",
      "cards-P001-P048",
    );
    expect(main.geometry.pageCount).toBe(2);
    await expect(page.locator(".learn-print-page svg")).toHaveCount(2);
    expect(Math.max(...drawnBottoms(main.geometry))).toBeLessThanOrEqual(
      282.05,
    );
  });
});

// Dense screenshots, so the card's QR modules are several pixels wide.
test.describe("kit v2 cards, read back", () => {
  test.use({ deviceScaleFactor: 3 });

  test("a printed card's QR code reads back as its participant at kit version 2, in the real checker", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    await page.setViewportSize({ width: 1400, height: 1800 });
    await page.goto("/learn/slates?kit=2&from=901&count=12");
    const svg = page.locator(".learn-print-page svg").first();
    const box = (await svg.boundingBox())!;
    const mmToPx = box.width / 210;
    // The first card: top-left (10, 8) mm, 60 x 30 mm, with a little paper round it.
    const clip = {
      x: box.x + (10 - 3) * mmToPx,
      y: box.y + (8 - 3) * mmToPx,
      width: 66 * mmToPx,
      height: 36 * mmToPx,
    };
    const photo = await page.screenshot({ clip, type: "png" });

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0001.png",
      mimeType: "image/png",
      buffer: photo,
    });
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 60_000 });
    const { reports } = JSON.parse((await json.textContent()) ?? "{}");
    expect(reports[0].code).toEqual({
      kind: "participant",
      version: 2,
      participant: "P901",
    });
    expect(reports[0].qrText).toBe("https://open-mouse.vercel.app/l/v2/P901");
  });
});

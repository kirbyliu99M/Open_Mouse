import { expect, test } from "@playwright/test";

/** See sheet-print.spec.ts: counts `/Type /Page` objects, not `/Pages`. */
function countPdfPageObjects(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

test.describe("learning kit", () => {
  test("the index links every kit page and keeps out of search", async ({
    page,
  }) => {
    await page.goto("/learn");
    await expect(
      page.getByRole("heading", { level: 1, name: "Learning kit" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Print both hands, 14 pages/ }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("prints one A4 page per pose and hand", async ({ page }) => {
    await page.goto("/learn/print?hands=both");
    await expect(page.locator(".learn-print-page svg")).toHaveCount(14);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(countPdfPageObjects(pdf)).toBe(14);

    await page.goto("/learn/print?hands=left");
    await expect(page.locator(".learn-print-page svg")).toHaveCount(7);
  });

  test("prints eight participant cards per page", async ({ page }) => {
    await page.goto("/learn/slates?from=5&count=10");
    await expect(page.locator(".learn-print-page svg")).toHaveCount(2);
    await expect(page.getByText("Cards P005 to P014.")).toBeVisible();
  });

  test("a printed QR code opens its pose's instructions", async ({ page }) => {
    await page.goto("/l/v1/G03R");
    await expect(
      page.getByRole("heading", { level: 1, name: "Palm grip" }),
    ).toBeVisible();
    await expect(page.getByText("Right hand, 3 photos.")).toBeVisible();
    await page.getByRole("link", { name: "Open the next pose" }).click();
    await expect(page).toHaveURL(/\/l\/v1\/G04R$/);

    await page.goto("/l/v1/G07R");
    await page.getByRole("link", { name: "Open the next pose" }).click();
    await expect(page).toHaveURL(/\/l\/v1\/G01L$/);

    await page.goto("/l/v1/P007");
    await expect(
      page.getByRole("heading", { level: 1, name: "Session P007" }),
    ).toBeVisible();

    const missing = await page.goto("/l/v1/G09R");
    expect(missing?.status()).toBe(404);
  });

  test("the checker identifies a photographed kit page on this device", async ({
    page,
  }) => {
    // Render the G01R page at about 8 px/mm and use that image as the "photo".
    await page.setViewportSize({ width: 1800, height: 2400 });
    await page.goto("/learn/print?hands=right");
    const svg = page.locator(".learn-print-page svg").first();
    const photo = await svg.screenshot({ type: "jpeg", quality: 92 });

    const uploads: string[] = [];
    page.on("request", (r) => {
      // next dev's error overlay POSTs stack frames for console errors
      // (MediaPipe logs an INFO line on start-up as an error); that is not app traffic.
      if (r.method() !== "GET" && !r.url().includes("/__nextjs"))
        uploads.push(r.url());
    });

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 60_000 });
    const { reports } = JSON.parse((await json.textContent()) ?? "{}");
    expect(reports[0].code).toEqual({
      kind: "gesture",
      version: 1,
      gesture: "G01",
      hand: "right",
    });
    expect(reports[0].markers.map((m: { id: number }) => m.id)).toEqual(
      expect.arrayContaining([0, 1, 2, 3]),
    );
    expect(reports[0].reprojectionErrorMm).toBeLessThan(1);
    // No hand on a bare page, so the photo is identified but must be retaken.
    expect(reports[0].verdict).toBe("retake");
    await expect(
      page.getByRole("heading", { level: 3, name: "G01R" }),
    ).toBeVisible();
    // Photos never leave the browser (hard rule 5).
    expect(uploads).toEqual([]);
  });
});

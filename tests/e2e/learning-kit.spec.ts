import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  PRIVATE,
  TAG,
  exifSegment,
  phoneSpec,
} from "../unit/helpers/exif-jpeg";

/** See sheet-print.spec.ts: counts `/Type /Page` objects, not `/Pages`. */
function countPdfPageObjects(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

/** A valid 1x1 white PNG: it decodes, but nothing can be found in it. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A printed page (0 = G01R, 5 = G06R, ... in print order for the right hand)
 * rendered at about 8 px/mm, used as the "photo".
 */
async function renderKitPagePhoto(page: Page, index = 0): Promise<Buffer> {
  await page.setViewportSize({ width: 1800, height: 2400 });
  await page.goto("/learn/print?hands=right");
  const svg = page.locator(".learn-print-page svg").nth(index);
  return svg.screenshot({ type: "jpeg", quality: 92 });
}

/**
 * Most of these tests do not depend on the device, so one project runs them
 * (the convention of camera-*.spec.ts: `testInfo.project.name`). Only the
 * index page, whose layout is checked at every width, runs in both.
 */
function onlyInChromium(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "chromium",
    "device-independent: run once, in the desktop project",
  );
}

/** Requests other than GET (next dev's error overlay posts stack frames; that is not app traffic). */
function watchUploads(page: Page): string[] {
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && !r.url().includes("/__nextjs"))
      uploads.push(r.url());
  });
  return uploads;
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

  test("prints one A4 page per pose and hand", async ({ page }, testInfo) => {
    onlyInChromium(testInfo);
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

  test("prints eight participant cards per page", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    await page.goto("/learn/slates?from=5&count=10");
    await expect(page.locator(".learn-print-page svg")).toHaveCount(2);
    await expect(page.getByText("Cards P005 to P014.")).toBeVisible();
    // Ruler values are written per hand: a Right and a Left column on every card.
    const card = page.locator(".learn-print-page svg").first();
    await expect(card.getByText("Right", { exact: true })).toHaveCount(8);
    await expect(card.getByText("Left", { exact: true })).toHaveCount(8);
    await expect(card.getByText("Hand length")).toHaveCount(8);
    await expect(card.getByText("Palm width")).toHaveCount(8);
    await expect(card.getByText(/R \/ L \/ both/)).toHaveCount(0);
  });

  test("a printed QR code opens its pose's instructions", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
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
  }, testInfo) => {
    onlyInChromium(testInfo);
    const photo = await renderKitPagePhoto(page);
    const uploads = watchUploads(page);

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 60_000 });
    const log = JSON.parse((await json.textContent()) ?? "{}");
    const { reports } = log;
    // Run log, format 3 (kit v1: no protocol, session or sheet).
    expect(log).toMatchObject({
      format: "open-mouse-learning-run/3",
      kitVersion: 1,
      protocol: null,
      session: null,
      sheet: null,
      paperSize: "a4",
      input: null,
      gitSha: null,
    });
    expect(reports[0]).toMatchObject({ kitVersion: 1, paperSize: "a4" });
    expect(Object.keys(reports[0].exif).sort()).toEqual([
      "focalLengthIn35mmFilm",
      "focalLengthMm",
      "pixelXDimension",
      "pixelYDimension",
    ]);
    // The four printed markers give a reference plane; there is no hand yet.
    expect(reports[0].markerPlane.method).toBe("markers");
    expect(reports[0].markerPlane.homography).toHaveLength(3);
    expect(reports[0].markerPlane.landmarksSheetMm).toBeNull();
    expect(reports[0].markerMm).toBeNull();
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
  test("the run log keeps only white-listed EXIF, and uses the photo's focal length", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const screenshot = await renderKitPagePhoto(page);
    // A phone-like EXIF block: GPS, time, serial number, device, lens, ...
    // (no Orientation tag, which would rotate the photo).
    const spec = phoneSpec();
    const exif = exifSegment({
      ...spec,
      ifd0: spec.ifd0!.filter((t) => t.tag !== TAG.orientation),
    });
    const photo = Buffer.concat([
      screenshot.subarray(0, 2),
      Buffer.from(exif),
      screenshot.subarray(2),
    ]);
    const uploads = watchUploads(page);

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0002.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 60_000 });
    const text = (await json.textContent()) ?? "";
    const { reports } = JSON.parse(text);

    expect(reports[0].exif).toEqual({
      focalLengthMm: 6.765,
      focalLengthIn35mmFilm: 24,
      pixelXDimension: 4032,
      pixelYDimension: 3024,
    });
    for (const secret of [
      PRIVATE.make,
      PRIVATE.model,
      PRIVATE.serial,
      PRIVATE.lens,
      PRIVATE.uniqueId,
      PRIVATE.dateTime,
      PRIVATE.software,
      String(PRIVATE.latitudeSeconds),
      String(PRIVATE.altitude),
    ]) {
      expect(text).not.toContain(secret);
    }
    // 35 mm focal length 24 mm -> px of the decoded frame (the product's formula).
    const { width, height } = reports[0];
    expect(reports[0].markerPlane.parallax.focalSource).toBe("exif");
    expect(reports[0].markerPlane.parallax.exifFocalPx).toBeCloseTo(
      (24 / 43.27) * Math.hypot(width, height),
      3,
    );
    expect(uploads).toEqual([]);
  });

  test("the sheet size is a setting: preset by ?paper=, changed on the page, and recorded", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const uploads = watchUploads(page);
    await page.goto("/learn/check?paper=letter");
    const select = page.getByTestId("learning-check-paper");
    await expect(select).toHaveValue("letter");

    // Anything that is not a known size falls back to A4.
    await page.goto("/learn/check?paper=toString");
    await expect(select).toHaveValue("a4");
    await page.goto("/learn/check?paper=nonsense");
    await expect(select).toHaveValue("a4");

    const photo = await renderKitPagePhoto(page);
    await page.goto("/learn/check");
    await select.selectOption("letter");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0003.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 60_000 });
    const log = JSON.parse((await json.textContent()) ?? "{}");
    expect(log.paperSize).toBe("letter");
    expect(log.reports[0].paperSize).toBe("letter");
    // Photos never leave the browser (hard rule 5): no request but GETs.
    expect(uploads).toEqual([]);
  });

  test("a side page gives a strip plane and no paper plane (G06)", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const photo = await renderKitPagePhoto(page, 5);
    const uploads = watchUploads(page);

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0004.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 60_000 });
    const { reports } = JSON.parse((await json.textContent()) ?? "{}");

    expect(reports[0].code).toMatchObject({ gesture: "G06", hand: "right" });
    expect(reports[0].markerPlane.method).toBe("strip-markers");
    expect(reports[0].markerPlane.homography).toHaveLength(3);
    // No paper detection on a side page.
    expect(reports[0].paperPlane).toBeNull();
    expect(reports[0].paperEdge).toBeNull();
    expect(reports[0].productGates).toBeNull();
    expect(uploads).toEqual([]);
  });

  test("the download button hands over the run log as a file", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const photo = await renderKitPagePhoto(page);
    const uploads = watchUploads(page);

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles({
      name: "IMG_0005.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    const button = page.getByRole("button", {
      name: "Download results (JSON)",
    });
    await expect(button).toBeEnabled({ timeout: 60_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      button.click(),
    ]);
    expect(download.suggestedFilename()).toBe("learning-manifest.json");
    const path = await download.path();
    const text = readFileSync(path, "utf-8");
    const log = JSON.parse(text);

    expect(log).toMatchObject({
      format: "open-mouse-learning-run/3",
      kitVersion: 1,
      paperSize: "a4",
      input: null,
    });
    expect(log.reports).toHaveLength(1);
    expect(log.reports[0]).toMatchObject({
      file: "IMG_0005.jpg",
      code: { gesture: "G01", hand: "right" },
    });
    // The same log the hidden test hook holds, and no photo bytes.
    const hooked = JSON.parse(
      (await page.getByTestId("learning-check-json").textContent()) ?? "{}",
    );
    expect(log.reports).toEqual(hooked.reports);
    expect(text).not.toContain("data:image");
    expect(text.length).toBeLessThan(200_000);
    expect(uploads).toEqual([]);
  });

  test("a photo that cannot be read, and one a detector chokes on, do not stop the others", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const good = await renderKitPagePhoto(page);
    const uploads = watchUploads(page);

    await page.goto("/learn/check");
    await page.getByTestId("learning-check-input").setInputFiles([
      // Not an image at all: the decoder refuses it.
      {
        name: "IMG_0006.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("this is not a jpeg at all"),
      },
      // A valid 1x1 image: it decodes, and then a detector throws on it.
      { name: "IMG_0007.png", mimeType: "image/png", buffer: TINY_PNG },
      { name: "IMG_0008.jpg", mimeType: "image/jpeg", buffer: good },
    ]);
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 90_000 });
    const { reports } = JSON.parse((await json.textContent()) ?? "{}");

    expect(reports.map((r: { file: string }) => r.file)).toEqual([
      "IMG_0006.jpg",
      "IMG_0007.png",
      "IMG_0008.jpg",
    ]);
    for (const failed of [reports[0], reports[1]]) {
      expect(failed.verdict).toBe("unidentified");
      expect(failed.error).toEqual(expect.any(String));
      expect(failed.errorKind).toEqual(expect.any(String));
    }
    // The detector failure says what kind of error it was, and nothing it said.
    expect(reports[1].error).toBe(
      "This photo couldn't be analysed. Retake it, and check the others as usual.",
    );
    expect(reports[1].errorKind).toBe("RangeError");
    // The photo after them was analysed as usual.
    expect(reports[2].code).toMatchObject({ gesture: "G01", hand: "right" });
    expect(reports[2].markerPlane.method).toBe("markers");
    expect(uploads).toEqual([]);
  });
});

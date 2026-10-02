/**
 * Kit v2 in a real browser: the checker reads a photo of sheet A with a
 * participant card in its slot (the markers, the card's QR code, the run log in
 * format 3), and an EXIF-stripped copy that keeps only Orientation decodes
 * upright, like its original.
 *
 * The "photos" are screenshots of the real print routes. There is no hand in
 * them (no synthetic photo makes MediaPipe detect one), so these tests are
 * about the sheet, the card and the decoding, not the hand.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { stripJpegMetadata } from "../../src/lib/learning/exifstrip";
import {
  TAG,
  exifSegment,
  phoneSpec,
  type ExifSpec,
} from "../unit/helpers/exif-jpeg";

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

/** Sheet A printed with participant card P901 in the slot, as a screenshot. */
async function sheetAWithCard(page: Page): Promise<Buffer> {
  await page.setViewportSize({ width: 1800, height: 2400 });
  // The card: the first of the S0 cards, cut out of the cards page.
  await page.goto("/learn/slates?kit=2&from=901&count=1");
  const cards = page.locator(".learn-print-page svg").first();
  const cardsBox = (await cards.boundingBox())!;
  const cardsScale = cardsBox.width / 210;
  const cardPng = await page.screenshot({
    clip: {
      x: cardsBox.x + 10 * cardsScale,
      y: cardsBox.y + 8 * cardsScale,
      width: 60 * cardsScale,
      height: 30 * cardsScale,
    },
    type: "png",
  });

  await page.goto("/learn/print?sheet=A");
  const sheet = page.locator(".learn-print-page svg").first();
  const box = (await sheet.boundingBox())!;
  const scale = box.width / 210;
  // Lay the card over the slot (60 x 30 mm at x 15, y 8).
  await page.evaluate(
    ({ png, left, top, width, height }) => {
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${png}`;
      img.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:9999`;
      document.body.appendChild(img);
      return img.decode();
    },
    {
      png: cardPng.toString("base64"),
      left: box.x + 15 * scale,
      top: box.y + 8 * scale,
      width: 60 * scale,
      height: 30 * scale,
    },
  );
  return page.screenshot({ clip: box, type: "jpeg", quality: 95 });
}

test.describe("kit v2 checker", () => {
  test.use({ deviceScaleFactor: 3 });

  test("reads sheet A with its card: markers, participant, and a format-3 run log", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    test.setTimeout(180_000);
    const photo = await sheetAWithCard(page);
    const uploads = watchUploads(page);

    await page.goto("/learn/check?sheet=A");
    await expect(page.getByTestId("learning-check-sheet")).toHaveValue("A");
    // Five photos: the planned G02 x3, G04 x2 (any other count needs shotCounts).
    await page.getByTestId("learning-check-input").setInputFiles(
      [1, 2, 3, 4, 5].map((n) => ({
        name: `IMG_000${n}.jpg`,
        mimeType: "image/jpeg",
        buffer: photo,
      })),
    );
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 150_000 });
    const log = JSON.parse((await json.textContent()) ?? "{}");

    // Run log, format 3: the kit v2 fields.
    expect(log).toMatchObject({
      format: "open-mouse-learning-run/3",
      kitVersion: 2,
      protocol: "agreed-v2",
      session: null,
      sheet: "A",
      paperSize: "a4",
      input: null,
      gitSha: null,
    });
    const report = log.reports[0];
    expect(report).toMatchObject({ kitVersion: 2, file: "IMG_0001.jpg" });
    // The card in the slot names the participant, at kit version 2.
    expect(report.code).toEqual({
      kind: "participant",
      version: 2,
      participant: "P901",
    });
    expect(report.qrText).toBe("https://open-mouse.vercel.app/l/v2/P901");
    // The product sheet's four markers give the plane.
    expect(report.markers.map((m: { id: number }) => m.id).sort()).toEqual(
      expect.arrayContaining([0, 1, 2, 3]),
    );
    expect(report.markerPlane.method).toBe("markers");
    expect(report.reprojectionErrorMm).toBeLessThan(1);
    // No hand on a bare sheet: the photo is still a hand photo (not a "slate"), to retake.
    expect(report.hand).toBeNull();
    expect(report.verdict).toBe("retake");
    // The order-based sort files it as the first G02 shot of P901, retake or not.
    expect(log.sort.photos[0]).toMatchObject({
      file: "IMG_0001.jpg",
      status: "ok",
      participant: "P901",
      gesture: "G02",
      shot: 1,
      hand: null,
      destination: "P901/G02/1.jpg",
      poseSource: "order",
      extraShot: false,
      poseCheck: { predicted: null, agrees: null },
    });
    expect(log.sort.participants).toMatchObject([
      { participant: "P901", photos: 5, status: "ok" },
    ]);
    // Photos never leave the browser (hard rule 5).
    expect(uploads).toEqual([]);
  });

  test("the kit selector: v1 by default, a sheet from ?sheet=, anything else is v1", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    const select = page.getByTestId("learning-check-sheet");
    await page.goto("/learn/check");
    await expect(select).toHaveValue("v1");
    await page.goto("/learn/check?sheet=B");
    await expect(select).toHaveValue("B");
    await page.goto("/learn/check?sheet=C");
    await expect(select).toHaveValue("v1");
    await page.goto("/learn/check?sheet=toString");
    await expect(select).toHaveValue("v1");
  });

  test("an EXIF-stripped copy that keeps only Orientation decodes upright, like its original", async ({
    page,
  }, testInfo) => {
    onlyInChromium(testInfo);
    test.setTimeout(180_000);
    const upright = await sheetAWithCard(page);
    // Store it the way a phone does for a portrait shot: sideways pixels (turned
    // a quarter anticlockwise) and an Orientation tag that turns it back.
    const sideways = Buffer.from(
      await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalHeight;
        c.height = img.naturalWidth;
        const ctx = c.getContext("2d")!;
        ctx.translate(0, c.height);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, 0, 0);
        return c.toDataURL("image/jpeg", 0.95).split(",")[1]!;
      }, upright.toString("base64")),
      "base64",
    );
    const spec: ExifSpec = phoneSpec();
    expect(spec.ifd0!.find((t) => t.tag === TAG.orientation)).toBeTruthy();
    const original = Buffer.concat([
      sideways.subarray(0, 2),
      Buffer.from(exifSegment(spec)),
      sideways.subarray(2),
    ]);
    const stripped = stripJpegMetadata(new Uint8Array(original));
    if (!stripped.ok) throw new Error("the original could not be stripped");
    expect(stripped.orientation).toBe(6);
    // A copy with all EXIF gone, Orientation too: what a naive stripper leaves.
    const naive = sideways;
    const uploads = watchUploads(page);

    await page.goto("/learn/check?sheet=A");
    await page.getByTestId("learning-check-input").setInputFiles([
      { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: original },
      {
        name: "IMG_0002.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from(stripped.bytes),
      },
      { name: "IMG_0003.jpg", mimeType: "image/jpeg", buffer: naive },
    ]);
    const json = page.getByTestId("learning-check-json");
    await expect(json).not.toBeEmpty({ timeout: 150_000 });
    const { reports } = JSON.parse((await json.textContent()) ?? "{}");
    const [a, b, c] = reports;

    // The original, and its stripped copy, decode upright (portrait) and the same.
    expect(a.height).toBeGreaterThan(a.width);
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    // And find the same markers and the same plane.
    expect(b.markers.map((m: { id: number }) => m.id).sort()).toEqual(
      a.markers.map((m: { id: number }) => m.id).sort(),
    );
    expect(b.markerPlane.homography).toEqual(a.markerPlane.homography);
    expect(b.code).toEqual(a.code);
    // The naive copy, with Orientation dropped, would be left lying on its side.
    expect(c.width).toBeGreaterThan(c.height);

    // The run log keeps the white-list from the original; the copy has none.
    expect(a.exif).toEqual({
      focalLengthMm: 6.765,
      focalLengthIn35mmFilm: 24,
      pixelXDimension: 4032,
      pixelYDimension: 3024,
    });
    expect(b.exif).toEqual({
      focalLengthMm: null,
      focalLengthIn35mmFilm: null,
      pixelXDimension: null,
      pixelYDimension: null,
    });
    expect(uploads).toEqual([]);
  });
});

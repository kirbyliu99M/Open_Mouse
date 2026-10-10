import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import { expect, test, type Page } from "@playwright/test";
import { decodePng } from "./fixtures/png";

/**
 * The share card at the three QR sizes Kirby is choosing between (2026-10-10),
 * on the data of his screenshot (ASUS ROG Strix Impact III, 92, Medium mouse,
 * Palm grip, Slim, no photo), and the check that each card's QR code still
 * decodes to the site URL with `jsqr`, the way a phone camera would read it
 * off a screen. Set SHARE_CARD_PREVIEW_DIR to also save the PNGs there.
 */
const DEMO = "/scan/share-card-demo";
const SITE_URL = "https://open-mouse.vercel.app";

async function withoutWebShare(page: Page) {
  await page.addInitScript(() => {
    for (const key of ["canShare", "share"])
      Object.defineProperty(navigator, key, {
        value: undefined,
        configurable: true,
      });
  });
}

async function makeCard(page: Page, query: string): Promise<Buffer> {
  await withoutWebShare(page);
  await page.goto(`${DEMO}?preset=rog&${query}`);
  const download = page.waitForEvent("download");
  await page.getByTestId("share-card-button").last().click();
  return readFileSync(await (await download).path());
}

function decodeQr(buffer: Buffer): string | null {
  const png = decodePng(buffer);
  const rgba = new Uint8ClampedArray(png.width * png.height * 4);
  for (let i = 0; i < png.width * png.height; i++) {
    rgba[i * 4] = png.data[i * png.channels]!;
    rgba[i * 4 + 1] = png.data[i * png.channels + 1]!;
    rgba[i * 4 + 2] = png.data[i * png.channels + 2]!;
    rgba[i * 4 + 3] = png.channels === 4 ? png.data[i * 4 + 3]! : 255;
  }
  return jsQR(rgba, png.width, png.height)?.data ?? null;
}

const CARDS: [file: string, query: string][] = [
  ["qr-144.png", "qr=144"],
  ["qr-160.png", "qr=160"],
  ["qr-176.png", "qr=176"],
  ["qr-160-zh.png", "qr=160&lang=zh"],
];

for (const [file, query] of CARDS) {
  test(`${file}: a 1080 x 1920 card whose QR code decodes to the site URL`, async ({
    page,
  }) => {
    const buffer = await makeCard(page, query);
    const png = decodePng(buffer);
    expect([png.width, png.height]).toEqual([1080, 1920]);
    expect(decodeQr(buffer)).toBe(SITE_URL);
    const dir = process.env.SHARE_CARD_PREVIEW_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, file), buffer);
    }
  });
}

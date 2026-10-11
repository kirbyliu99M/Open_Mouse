import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import { expect, test, type Page } from "@playwright/test";
import { decodePng, type DecodedPng } from "./fixtures/png";

/**
 * The share card at the QR sizes and styles Kirby is choosing between
 * (2026-10-10), on the data of his screenshot (ASUS ROG Strix Impact III, 92,
 * Medium mouse, Palm grip, Slim, no photo), and the check that each card's QR
 * code still decodes to the site URL with `jsqr`, the way a phone camera would
 * read it off a screen. Set SHARE_CARD_PREVIEW_DIR to also save the PNGs (and a
 * `decode-results.json`) there.
 *
 * Decoding is tried three ways: as the card is (`dontInvert`), with the
 * inverted image as well (`attemptBoth`), and on a copy shrunk to 360 x 640, a
 * phone thumbnail. An inverted code (light modules on a dark ground) can only
 * pass with inversion, and some phone scanners do not try it. The thumbnail is
 * recorded, not asserted: it shows how small a 5 px module gets, and is
 * information for the person choosing.
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

function toRgba(png: DecodedPng): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(png.width * png.height * 4);
  for (let i = 0; i < png.width * png.height; i++) {
    rgba[i * 4] = png.data[i * png.channels]!;
    rgba[i * 4 + 1] = png.data[i * png.channels + 1]!;
    rgba[i * 4 + 2] = png.data[i * png.channels + 2]!;
    rgba[i * 4 + 3] = png.channels === 4 ? png.data[i * 4 + 3]! : 255;
  }
  return rgba;
}

/** A box-filter shrink by a whole factor (1080 x 1920 by 3 is 360 x 640). */
function shrink(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
) {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++)
          for (let dx = 0; dx < factor; dx++)
            sum +=
              rgba[((y * factor + dy) * width + x * factor + dx) * 4 + ch]!;
        out[(y * w + x) * 4 + ch] = Math.round(sum / (factor * factor));
      }
  return { data: out, width: w, height: h };
}

/** The QR box and 24 px around it, as its own image (a camera framed on the code). */
function cropAround(rgba: Uint8ClampedArray, width: number, side: number) {
  const pad = 24;
  const w = side + 2 * pad;
  const x0 = 1080 - 84 - side - pad;
  const y0 = 1920 - 84 - side - pad;
  const out = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < 4; ch++)
        out[(y * w + x) * 4 + ch] = rgba[((y0 + y) * width + x0 + x) * 4 + ch]!;
  return { data: out, width: w, height: w };
}

function decode(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  inversionAttempts: "dontInvert" | "attemptBoth",
): string | null {
  return jsQR(data, width, height, { inversionAttempts })?.data ?? null;
}

type Rgb = readonly [number, number, number];
const pixel = (png: DecodedPng, x: number, y: number): Rgb => {
  const i = (y * png.width + x) * png.channels;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
};
const near = (a: Rgb, b: Rgb, tolerance = 24) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tolerance;
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * What the style really drew, read back from the PNG: the pixel in the panel's
 * plain margin, and the top-left finder eye's ring and centre. The box sits on
 * the bottom-right margin; its code starts `offset` px in (5 px step, 29 modules).
 * This is what would have caught a style that never reached the renderer.
 */
const EYE_RING = 17; // half the 7-module eye, in px at a 5 px step, minus the ring
function expectStyleDrawn(
  png: DecodedPng,
  style: "classic" | "softLight" | "darkTile" | "frameless",
) {
  const side = style === "frameless" ? 185 : 176;
  const boxX = 1080 - 84 - side;
  const boxY = 1920 - 84 - side;
  const offset = style === "frameless" ? 20 : 15;
  const margin = pixel(png, boxX + 6, boxY + 6);
  const ox = boxX + offset;
  const oy = boxY + offset;
  const ring = pixel(png, ox + 2, oy + EYE_RING);
  const centre = pixel(png, ox + EYE_RING, oy + EYE_RING);
  const at = (what: string, got: Rgb) => `${style} ${what} was ${got}`;
  const table: Record<
    typeof style,
    { margin: Rgb | null; ring: Rgb; centre: Rgb }
  > = {
    classic: {
      margin: [255, 255, 255],
      ring: [6, 7, 9],
      centre: [6, 7, 9],
    },
    softLight: {
      margin: [0xdc, 0xe6, 0xff],
      ring: [0x24, 0x63, 0xeb],
      centre: [0x0a, 0x14, 0x30],
    },
    darkTile: {
      margin: null,
      ring: [0x7f, 0xa8, 0xff],
      centre: [0xcf, 0xe0, 0xff],
    },
    frameless: {
      margin: null,
      ring: [0x7f, 0xa8, 0xff],
      centre: [0xcf, 0xe0, 0xff],
    },
  };
  const expected = table[style];
  if (expected.margin)
    expect(near(margin, expected.margin), at("panel", margin)).toBe(true);
  else expect(luminance(margin), at("panel (dark)", margin)).toBeLessThan(60);
  expect(near(ring, expected.ring), at("eye ring", ring)).toBe(true);
  expect(near(centre, expected.centre), at("eye centre", centre)).toBe(true);
}

const results: Record<string, Record<string, string>> = {};
const verdict = (got: string | null) => (got === SITE_URL ? "pass" : "fail");

const SIZE_CARDS: [file: string, query: string][] = [
  ["qr-144.png", "qr=144&qrStyle=classic"],
  ["qr-160.png", "qr=160&qrStyle=classic"],
  ["qr-176.png", "qr=176&qrStyle=classic"],
  ["qr-160-zh.png", "qr=160&qrStyle=classic&lang=zh"],
];

/** The candidate styles, all at the 176 px panel (5 px step). */
const STYLE_CARDS: [
  file: string,
  query: string,
  inverted: boolean,
  style: "softLight" | "darkTile" | "frameless",
][] = [
  ["style-v1.png", "qr=176&qrStyle=softLight", false, "softLight"],
  ["style-v2.png", "qr=176&qrStyle=darkTile", true, "darkTile"],
  // V3 is the default: no `qr` and no `qrStyle`, the path the real card takes.
  ["style-v3.png", "", true, "frameless"],
  ["style-v3-zh.png", "lang=zh", true, "frameless"],
  ["style-v1-zh.png", "qr=176&qrStyle=softLight&lang=zh", false, "softLight"],
];

function save(file: string, buffer: Buffer) {
  const dir = process.env.SHARE_CARD_PREVIEW_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), buffer);
}

for (const [file, query] of SIZE_CARDS) {
  test(`${file}: a 1080 x 1920 card whose QR code decodes to the site URL`, async ({
    page,
  }) => {
    const buffer = await makeCard(page, query);
    const png = decodePng(buffer);
    expect([png.width, png.height]).toEqual([1080, 1920]);
    expect(decode(toRgba(png), png.width, png.height, "attemptBoth")).toBe(
      SITE_URL,
    );
    // The classic style was asked for: the plain code, black on white.
    const panel = pixel(png, 1080 - 84 - 12, 1920 - 84 - 12);
    expect(near(panel, [255, 255, 255]), `classic panel was ${panel}`).toBe(
      true,
    );
    save(file, buffer);
  });
}

for (const [file, query, inverted, style] of STYLE_CARDS) {
  test(`${file}: ${query} decodes to the site URL (${inverted ? "inverted" : "not inverted"})`, async ({
    page,
  }) => {
    const buffer = await makeCard(page, query);
    const png = decodePng(buffer);
    expect([png.width, png.height]).toEqual([1080, 1920]);
    // The style really reached the renderer.
    expectStyleDrawn(png, style);
    const rgba = toRgba(png);
    const small = shrink(rgba, png.width, png.height, 3);
    const framed = cropAround(
      rgba,
      png.width,
      style === "frameless" ? 185 : 176,
    );
    const row = {
      dontInvert: verdict(decode(rgba, png.width, png.height, "dontInvert")),
      attemptBoth: verdict(decode(rgba, png.width, png.height, "attemptBoth")),
      framedDontInvert: verdict(
        decode(framed.data, framed.width, framed.height, "dontInvert"),
      ),
      framedAttemptBoth: verdict(
        decode(framed.data, framed.width, framed.height, "attemptBoth"),
      ),
      thumbnailDontInvert: verdict(
        decode(small.data, small.width, small.height, "dontInvert"),
      ),
      thumbnailAttemptBoth: verdict(
        decode(small.data, small.width, small.height, "attemptBoth"),
      ),
    };
    results[file] = row;
    test.info().annotations.push({
      type: "decode",
      description: JSON.stringify(row),
    });
    console.log(`DECODE ${file} ${JSON.stringify(row)}`);
    save(file, buffer);
    const dir = process.env.SHARE_CARD_PREVIEW_DIR;
    if (dir)
      writeFileSync(
        path.join(dir, "decode-results.json"),
        JSON.stringify(results, null, 2),
      );
    // A not-inverted style decodes as it is; an inverted one only with
    // inversion (that is also what proves the style was really drawn).
    expect(row.dontInvert).toBe(inverted ? "fail" : "pass");
    expect(row.framedDontInvert).toBe(inverted ? "fail" : "pass");
    // With both polarities tried, the code decodes in the whole card or in the
    // framed crop. jsqr's locator is touchy about what surrounds an inverted
    // code (the mouse outline, the text, the tile's edge), so which of the two
    // reads differs between V2 and V3; the whole table is recorded in
    // decode-results.json. A phone camera is a better reader than jsqr.
    expect(
      row.attemptBoth === "pass" || row.framedAttemptBoth === "pass",
      JSON.stringify(row),
    ).toBe(true);
  });
}

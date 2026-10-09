import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_URL } from "../../src/lib/site";

/**
 * The brand image files in src/app/ (Next's file convention) have the sizes the
 * platforms expect, and the site address is a plain origin, so it can serve as
 * `metadataBase` in layout.tsx.
 */
const APP_DIR = path.resolve(__dirname, "../../src/app");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(path.join(APP_DIR, file));
  expect(buf.subarray(1, 4).toString("ascii"), file).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("brand image files", () => {
  it("icon.png is 512 x 512", () => {
    expect(pngSize("icon.png")).toEqual({ width: 512, height: 512 });
  });

  it("apple-icon.png is 180 x 180", () => {
    expect(pngSize("apple-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("the share images are 1200 x 630 and identical", () => {
    expect(pngSize("opengraph-image.png")).toEqual({
      width: 1200,
      height: 630,
    });
    expect(pngSize("twitter-image.png")).toEqual({ width: 1200, height: 630 });
    expect(readFileSync(path.join(APP_DIR, "twitter-image.png"))).toEqual(
      readFileSync(path.join(APP_DIR, "opengraph-image.png")),
    );
  });

  it("favicon.ico holds the 16, 32 and 48 px sizes", () => {
    const buf = readFileSync(path.join(APP_DIR, "favicon.ico"));
    expect(buf.readUInt16LE(0)).toBe(0); // reserved
    expect(buf.readUInt16LE(2)).toBe(1); // type: icon
    const count = buf.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16]);
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });
});

describe("SITE_URL", () => {
  it("is an https origin with no path, so it can be metadataBase", () => {
    const url = new URL(SITE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(SITE_URL);
  });
});

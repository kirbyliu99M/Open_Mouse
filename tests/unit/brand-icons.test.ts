import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import { SITE_URL } from "../../src/lib/site";

/**
 * The brand image files in src/app/ (Next's file convention) have the sizes the
 * platforms expect, and the site address is a plain origin, so it can serve as
 * `metadataBase` in layout.tsx.
 */
const APP_DIR = path.resolve(__dirname, "../../src/app");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

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

  it("apple-icon.png is 180 x 180 and opaque (no alpha channel)", () => {
    expect(pngSize("apple-icon.png")).toEqual({ width: 180, height: 180 });
    const buf = readFileSync(path.join(APP_DIR, "apple-icon.png"));
    // IHDR color type: 4 = grayscale + alpha, 6 = RGB + alpha. iOS fills
    // transparency with black, so the touch icon must have neither.
    const colorType = buf[25];
    expect([4, 6]).not.toContain(colorType);
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

  it("favicon.ico holds the 16, 32 and 48 px sizes, each a whole embedded PNG", () => {
    const buf = readFileSync(path.join(APP_DIR, "favicon.ico"));
    expect(buf.readUInt16LE(0)).toBe(0); // reserved
    expect(buf.readUInt16LE(2)).toBe(1); // type: icon
    const count = buf.readUInt16LE(4);
    expect(count).toBe(3);

    const declared: number[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const width = buf[entry] || 256; // 0 means 256
      const height = buf[entry + 1] || 256;
      const size = buf.readUInt32LE(entry + 8);
      const offset = buf.readUInt32LE(entry + 12);

      // The image data lies inside the file.
      expect(offset + size, `entry ${i} range`).toBeLessThanOrEqual(buf.length);
      // It is an embedded PNG whose own size matches the directory.
      const image = buf.subarray(offset, offset + size);
      expect(image.subarray(0, 4).equals(PNG_SIGNATURE), `entry ${i} PNG`).toBe(
        true,
      );
      expect(image.readUInt32BE(16), `entry ${i} width`).toBe(width);
      expect(image.readUInt32BE(20), `entry ${i} height`).toBe(height);
      declared.push(width);
    }
    expect(declared.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });
});

describe("SITE_URL", () => {
  it("is an https origin with no path, so it can be metadataBase", () => {
    const url = new URL(SITE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(SITE_URL);
  });
});

describe("root layout metadata", () => {
  // The default e2e run uses `next dev`, which always rewrites metadataBase to
  // localhost, so it cannot notice the line being deleted. This does.
  it("sets metadataBase to the SITE_URL origin", () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.metadataBase?.origin).toBe(new URL(SITE_URL).origin);
  });

  it("gives the share cards the same description as the page", () => {
    expect(metadata.description).toBeTruthy();
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });
});

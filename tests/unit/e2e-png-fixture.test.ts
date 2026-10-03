import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { averageColour, decodePng } from "../e2e/fixtures/png";

/**
 * decodePng reads the pixels of a Playwright screenshot in the e2e suite.
 * Here it reads PNGs built in the test, with every scanline filter, and checks
 * the pixels come back exactly.
 */
function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** Encodes `rows` of `channels`-byte pixels, scanline y with filter `filters[y]`. */
function encode(rows: number[][], channels: 3 | 4, filters: number[]): Buffer {
  const height = rows.length;
  const stride = rows[0].length;
  const width = stride / channels;
  const lines: number[] = [];
  rows.forEach((row, y) => {
    const filter = filters[y % filters.length];
    lines.push(filter);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = y > 0 ? rows[y - 1][x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[y - 1][x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      lines.push((row[x] - predictor) & 255);
    }
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(lines))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A small picture with edges and gradients, so every filter has something to predict. */
function picture(width: number, height: number, channels: 3 | 4): number[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width * channels }, (_, i) => {
      const x = Math.floor(i / channels);
      const c = i % channels;
      if (c === 3) return 255;
      return (x * 37 + y * 53 + c * 91 + ((x * y) % 17)) & 255;
    }),
  );
}

describe("decodePng", () => {
  for (const channels of [3, 4] as const) {
    for (const filter of [0, 1, 2, 3, 4]) {
      it(`reads ${channels === 4 ? "RGBA" : "RGB"} scanlines filtered with type ${filter}`, () => {
        const rows = picture(9, 6, channels);
        const png = decodePng(encode(rows, channels, [filter]));
        expect(png.width).toBe(9);
        expect(png.height).toBe(6);
        expect(png.channels).toBe(channels);
        expect([...png.data]).toEqual(rows.flat());
      });
    }
  }

  it("reads a picture whose scanlines use a different filter each", () => {
    const rows = picture(11, 10, 4);
    const png = decodePng(encode(rows, 4, [0, 1, 2, 3, 4, 4, 3, 2, 1, 0]));
    expect([...png.data]).toEqual(rows.flat());
  });

  it("refuses what it does not read", () => {
    expect(() => decodePng(Buffer.from("not a png at all"))).toThrow();
  });

  it("averageColour is the mean of the pixels", () => {
    const rows = [
      [10, 20, 30, 255, 30, 40, 50, 255],
      [50, 60, 70, 255, 70, 80, 90, 255],
    ];
    const [r, g, b] = averageColour(decodePng(encode(rows, 4, [0])));
    expect([r, g, b]).toEqual([40, 50, 60]);
  });
});

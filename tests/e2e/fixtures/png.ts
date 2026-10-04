import { inflateSync } from "node:zlib";

/**
 * A just-enough PNG reader for what a Playwright screenshot is: 8-bit RGB or
 * RGBA, not interlaced. It lets a test look at the pixels that were really
 * painted (for example, whether a focus ring is covered by something drawn
 * over it), which no DOM query can say. No dependency: zlib is Node's own.
 */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  readonly channels: 3 | 4;
  /** Row after row, top to bottom, `channels` bytes per pixel. */
  readonly data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(buffer: Buffer): DecodedPng {
  for (let i = 0; i < 8; i++)
    if (buffer[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let colourType = 0;
  const parts: Buffer[] = [];
  for (let at = 8; at < buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colourType = body[9];
      if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not read`);
      if (body[12] !== 0) throw new Error("interlaced PNG is not read");
      if (colourType !== 2 && colourType !== 6)
        throw new Error(`PNG colour type ${colourType} is not read`);
    } else if (type === "IDAT") {
      parts.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const value = raw[line + x];
      const left = x >= channels ? data[y * stride + x - channels] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? data[(y - 1) * stride + x - channels] : 0;
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
      } else if (filter !== 0) {
        throw new Error(`PNG filter ${filter} is not known`);
      }
      data[y * stride + x] = (value + predictor) & 255;
    }
  }
  return { width, height, channels, data };
}

/** The average colour of the whole image, as [r, g, b]. */
export function averageColour(png: DecodedPng): [number, number, number] {
  const sum = [0, 0, 0];
  const pixels = png.width * png.height;
  for (let i = 0; i < pixels; i++)
    for (let c = 0; c < 3; c++) sum[c] += png.data[i * png.channels + c];
  return [sum[0] / pixels, sum[1] / pixels, sum[2] / pixels];
}

/** The average colour of each row of the image, top to bottom, as [r, g, b]. */
export function rowAverageColours(png: DecodedPng): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (let y = 0; y < png.height; y++) {
    const sum = [0, 0, 0];
    for (let x = 0; x < png.width; x++) {
      const at = (y * png.width + x) * png.channels;
      for (let c = 0; c < 3; c++) sum[c] += png.data[at + c];
    }
    rows.push([sum[0] / png.width, sum[1] / png.width, sum[2] / png.width]);
  }
  return rows;
}

/**
 * How far the best row of the image is from `want`: for each row, the largest
 * channel difference between the row's average colour and `want`; then the
 * smallest of those. A band laid over a stripe of colour `want` that is a few
 * pixels thick finds at least one row inside the stripe at any sub-pixel
 * position (the rows at its edges are blended with what is behind it, which is
 * why a band's overall average is not the stripe's colour); a band with no
 * such stripe in it, or with the stripe painted over, has no row near `want`.
 */
export function bestRowOff(png: DecodedPng, want: readonly number[]): number {
  return Math.min(
    ...rowAverageColours(png).map((row) =>
      Math.max(
        Math.abs(row[0] - want[0]),
        Math.abs(row[1] - want[1]),
        Math.abs(row[2] - want[2]),
      ),
    ),
  );
}

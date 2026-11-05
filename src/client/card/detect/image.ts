/**
 * Scan Lab card detector (L3a, 2026-10-29): the small image primitives the
 * coarse finder (`coarse.ts`) and the edge refiner (`refine.ts`) share.
 * Pure: they only read `data`, never touch the DOM.
 *
 * Coordinates: image px, x right, y down, and pixel (i, j) has its CENTRE
 * at (i + 0.5, j + 0.5) — the same convention `src/client/paper/detect.ts`
 * uses for its boundary points, so corners from both detectors can be
 * compared or mixed in one homography without a half-pixel shift.
 */

/** An RGBA frame (ImageData-shaped; alpha is ignored). */
export interface RgbaImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** `true` when `img` has positive integer dimensions and `width*height*4` bytes. */
export function isValidRgbaImage(img: RgbaImage): boolean {
  return (
    Number.isInteger(img.width) &&
    Number.isInteger(img.height) &&
    img.width > 0 &&
    img.height > 0 &&
    img.data.length === img.width * img.height * 4
  );
}

/**
 * Box-average `img` down by an integer `factor` (1 returns `img` itself).
 * Pixel (i, j) of the result covers source pixels [i*f, (i+1)*f) x
 * [j*f, (j+1)*f), so a point at (x, y) in the result is at (x*f, y*f) in
 * the source (pixel edges line up; see `scalePoint`).
 */
export function downscaleImage(img: RgbaImage, factor: number): RgbaImage {
  if (factor <= 1) return img;
  const f = Math.floor(factor);
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Uint8ClampedArray(w * h * 4);
  const n = f * f;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < f; dy++) {
        let o = ((j * f + dy) * img.width + i * f) * 4;
        for (let dx = 0; dx < f; dx++, o += 4) {
          r += img.data[o];
          g += img.data[o + 1];
          b += img.data[o + 2];
        }
      }
      const q = (j * w + i) * 4;
      out[q] = r / n;
      out[q + 1] = g / n;
      out[q + 2] = b / n;
      out[q + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Bilinear RGB sample at continuous image position (x, y) (pixel centres at
 * +0.5), clamped at the frame border. Writes into `out` to avoid
 * allocating in the refiner's inner loop.
 */
export function sampleRgb(
  img: RgbaImage,
  x: number,
  y: number,
  out: number[],
): void {
  const { width: w, height: h, data } = img;
  let u = x - 0.5;
  let v = y - 0.5;
  if (u < 0) u = 0;
  else if (u > w - 1) u = w - 1;
  if (v < 0) v = 0;
  else if (v > h - 1) v = h - 1;
  const i0 = Math.min(Math.floor(u), w - 2 < 0 ? 0 : w - 2);
  const j0 = Math.min(Math.floor(v), h - 2 < 0 ? 0 : h - 2);
  const i1 = Math.min(i0 + 1, w - 1);
  const j1 = Math.min(j0 + 1, h - 1);
  const fu = u - i0;
  const fv = v - j0;
  const o00 = (j0 * w + i0) * 4;
  const o10 = (j0 * w + i1) * 4;
  const o01 = (j1 * w + i0) * 4;
  const o11 = (j1 * w + i1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = data[o00 + c] * (1 - fu) + data[o10 + c] * fu;
    const bottom = data[o01 + c] * (1 - fu) + data[o11 + c] * fu;
    out[c] = top * (1 - fv) + bottom * fv;
  }
}

/**
 * Colour gradient magnitude per pixel: each RGB channel is smoothed with a
 * 3x3 binomial kernel, then Sobel'd; the magnitude is
 * sqrt(sum over channels of gx^2 + gy^2) / 8, which is roughly "grey levels
 * per px" for a ramp. Colour, not luminance, because a card back and a
 * table can differ in hue at nearly the same brightness. Border pixels are 0.
 */
export function colourGradientMagnitude(img: RgbaImage): Float32Array {
  const { width: w, height: h, data } = img;
  const smooth = new Float32Array(w * h * 3);
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : w - 1;
      for (let c = 0; c < 3; c++) {
        tmp[(y * w + x) * 3 + c] =
          (data[(y * w + xl) * 4 + c] +
            2 * data[(y * w + x) * 4 + c] +
            data[(y * w + xr) * 4 + c]) /
          4;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        smooth[(y * w + x) * 3 + c] =
          (tmp[(yu * w + x) * 3 + c] +
            2 * tmp[(y * w + x) * 3 + c] +
            tmp[(yd * w + x) * 3 + c]) /
          4;
      }
    }
  }
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      const up = ((y - 1) * w + x) * 3;
      const mid = (y * w + x) * 3;
      const down = ((y + 1) * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        const ul = smooth[up - 3 + c];
        const uc = smooth[up + c];
        const ur = smooth[up + 3 + c];
        const ml = smooth[mid - 3 + c];
        const mr = smooth[mid + 3 + c];
        const dl = smooth[down - 3 + c];
        const dc = smooth[down + c];
        const dr = smooth[down + 3 + c];
        const gx = ur + 2 * mr + dr - ul - 2 * ml - dl;
        const gy = dl + 2 * dc + dr - ul - 2 * uc - ur;
        sum += gx * gx + gy * gy;
      }
      mag[y * w + x] = Math.sqrt(sum) / 8;
    }
  }
  return mag;
}

/**
 * Sharpness check via Laplacian variance — the standard cheap blur
 * detector: convolve a grayscale image with the discrete Laplacian kernel
 * `[[0,1,0],[1,-4,1],[0,1,0]]` and take the variance of the responses. A
 * sharp, detailed image has high-frequency edges everywhere, so the
 * responses spread widely; a blurry image is locally smooth, so they
 * cluster near zero.
 *
 * Pure pixel-array math — no DOM/Canvas dependency — so it is unit-testable
 * with synthetic arrays in the Node test environment. The RGBA → grayscale
 * step and the actual `ImageData` come from the browser-only call site
 * (`src/client/photo/pipeline.ts`).
 */

/** ITU-R BT.601 luma weights — the same ones canvas 2D contexts use. */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/** Convert RGBA pixel data (e.g. `ImageData.data`) to a flat grayscale array. */
export function rgbaToGrayscale(
  data: ArrayLike<number>,
  pixelCount: number,
): Float64Array {
  const gray = new Float64Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = LUMA_R * r + LUMA_G * g + LUMA_B * b;
  }
  return gray;
}

/**
 * Variance of the 3×3 discrete Laplacian response over a grayscale image,
 * ignoring the 1-pixel border. Higher = sharper. Throws for images too
 * small to have an interior.
 */
export function computeLaplacianVariance(
  gray: ArrayLike<number>,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) {
    throw new RangeError(
      `computeLaplacianVariance needs at least a 3×3 image, got ${width}×${height}.`,
    );
  }
  if (gray.length !== width * height) {
    throw new RangeError(
      `computeLaplacianVariance: gray.length (${gray.length}) must equal width×height (${width * height}).`,
    );
  }

  const interiorCount = (width - 2) * (height - 2);
  const responses = new Float64Array(interiorCount);
  let i = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      responses[i++] =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - width] +
        gray[idx + width];
    }
  }

  let mean = 0;
  for (const v of responses) mean += v;
  mean /= responses.length;

  let variance = 0;
  for (const v of responses) variance += (v - mean) ** 2;
  variance /= responses.length;

  return variance;
}

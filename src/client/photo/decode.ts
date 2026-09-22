/**
 * Decode a user-chosen photo file into one upright, size-bounded
 * `ImageBitmap` that markers.ts, card.ts and landmarks.ts all read from —
 * "ArUco and MediaPipe must run on the same bitmap so their coordinates
 * share a frame" (docs/PLAN.md §M2).
 *
 * `createImageBitmap(file, { imageOrientation: "from-image" })` does the
 * real work: it reads the file's EXIF orientation tag and returns a
 * bitmap already rotated upright, so nothing here re-implements EXIF
 * parsing. `computeDownscaleSize` below is the one piece of custom, pure
 * logic and is unit-tested directly; the browser-only decode path itself
 * is exercised in `tests/e2e/scan.spec.ts` against a synthetic
 * EXIF-rotated JPEG (real image decoding needs a browser image codec,
 * which the Node/Vitest unit environment doesn't have).
 */

export const MAX_LONG_EDGE_PX = 3000;

/**
 * Scale `{width, height}` down so its long edge is at most `maxLongEdge`,
 * preserving aspect ratio. Returns the input unchanged if it's already
 * within bounds. Pure.
 */
export function computeDownscaleSize(
  width: number,
  height: number,
  maxLongEdge: number = MAX_LONG_EDGE_PX,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    throw new RangeError(
      `computeDownscaleSize needs positive dimensions, got ${width}×${height}.`,
    );
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class PhotoDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoDecodeError";
  }
}

export const HEIC_RETAKE_MESSAGE =
  "This photo couldn't be opened — export it as a JPEG and try again.";

export interface DecodedPhoto {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
}

/**
 * Decode `file` upright (EXIF-corrected) and downscale it to at most
 * `MAX_LONG_EDGE_PX` on the long edge. A decode failure (HEIC on a
 * desktop browser, a corrupt file, …) throws `PhotoDecodeError` with the
 * exact retake copy the UI shows.
 */
export async function decodePhoto(file: File): Promise<DecodedPhoto> {
  let original: ImageBitmap;
  try {
    original = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
  } catch {
    throw new PhotoDecodeError(HEIC_RETAKE_MESSAGE);
  }

  const target = computeDownscaleSize(original.width, original.height);
  if (target.width === original.width && target.height === original.height) {
    return { bitmap: original, width: target.width, height: target.height };
  }

  try {
    const resized = await createImageBitmap(original, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
    });
    original.close();
    return { bitmap: resized, width: target.width, height: target.height };
  } catch {
    // Resizing an already-decoded bitmap failing is unexpected, but not a
    // reason to fail the whole scan — fall back to the full-resolution
    // decode rather than blocking the user.
    return { bitmap: original, width: original.width, height: original.height };
  }
}

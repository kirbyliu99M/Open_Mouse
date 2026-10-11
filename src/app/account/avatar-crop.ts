/**
 * Cropping an avatar photo to a small square in the browser, before anything
 * is sent (Vercel storage is nearly full, so the upload is about 256 px).
 * `squareCrop` is pure and tested; `cropToSquareBlob` needs a browser. Nothing
 * here sends the picture anywhere: the caller hands the Blob to the page's
 * `saveAvatar` prop, which does not exist yet (no route saves an avatar).
 */

/** The side of the saved avatar in pixels (candidate). */
export const AVATAR_SIZE_PX = 256;

/** The centred square of a width x height picture, in source pixels. */
export function squareCrop(
  width: number,
  height: number,
): { sx: number; sy: number; side: number } {
  const side = Math.max(0, Math.min(width, height));
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
  };
}

/** The side to draw at: never enlarge a small photo. */
export function outputSide(side: number, target = AVATAR_SIZE_PX): number {
  return Math.max(1, Math.min(side, target));
}

/**
 * Decodes an image file, crops its centre to a square, shrinks it and returns
 * a WebP (JPEG where the browser cannot encode WebP). Rejects when the file is
 * not an image the browser can decode.
 */
export async function cropToSquareBlob(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height);
    if (side === 0) throw new Error("empty image");
    const out = outputSide(side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/webp",
        0.85,
      );
    });
  } finally {
    bitmap.close();
  }
}

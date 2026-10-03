/**
 * Draws QR codes into a plain RGBA pixel array, for tests that need a photo
 * with more than one QR code in it. NOT a test file.
 */
import { qrMatrix, QR_QUIET_MODULES } from "../../../src/lib/learning/qr";

export interface Raster {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** A white image. */
export function whiteImage(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}

/**
 * Stamp the QR code for `text` with its top-left corner (quiet zone included)
 * at (x, y), `pxPerModule` pixels per module. Returns its side in pixels.
 */
export function drawQr(
  image: Raster,
  text: string,
  x: number,
  y: number,
  pxPerModule: number,
): number {
  const { size, dark } = qrMatrix(text);
  const side = (size + 2 * QR_QUIET_MODULES) * pxPerModule;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!dark[row]![col]) continue;
      const x0 = x + (col + QR_QUIET_MODULES) * pxPerModule;
      const y0 = y + (row + QR_QUIET_MODULES) * pxPerModule;
      for (let py = 0; py < pxPerModule; py++) {
        for (let px = 0; px < pxPerModule; px++) {
          const at = ((y0 + py) * image.width + (x0 + px)) * 4;
          image.data[at] = image.data[at + 1] = image.data[at + 2] = 0;
        }
      }
    }
  }
  return side;
}

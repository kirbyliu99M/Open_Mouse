/**
 * Builds a tiny synthetic JPEG with a real EXIF Orientation tag, entirely
 * in-memory — for tests/e2e/scan.spec.ts's decode-orientation assertion.
 * `src/client/photo/decode.ts` delegates all orientation correction to the
 * browser's own image codec via
 * `createImageBitmap(file, { imageOrientation: "from-image" })`, which
 * Node/Vitest has no equivalent for, so this is exercised in a real
 * browser (Playwright) rather than a unit test.
 */
import type { Page } from "@playwright/test";

export interface ExifRotatedJpeg {
  readonly buffer: Buffer;
  /** Pixel dimensions as literally stored in the file. */
  readonly storedWidth: number;
  readonly storedHeight: number;
  /** Dimensions after EXIF orientation 6 (rotate 90° CW) is applied. */
  readonly displayWidth: number;
  readonly displayHeight: number;
}

/**
 * Renders a plain white rectangle with a small red square in one corner
 * (canvas has no EXIF support, so the pixels are stored "as if" the camera
 * was held normally), exports it as a real JPEG via the browser's own
 * encoder, then splices in a minimal EXIF APP1 segment with
 * Orientation = 6 ("rotate 90° CW to display upright").
 */
export async function buildExifRotatedJpeg(
  page: Page,
): Promise<ExifRotatedJpeg> {
  const storedWidth = 200;
  const storedHeight = 100;

  const base64 = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 40, 40);
      return new Promise<string>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("canvas.toBlob returned null"));
              return;
            }
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve((reader.result as string).split(",")[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.95,
        );
      });
    },
    { width: storedWidth, height: storedHeight },
  );

  const buffer = injectExifOrientation(Buffer.from(base64, "base64"), 6);

  return {
    buffer,
    storedWidth,
    storedHeight,
    displayWidth: storedHeight,
    displayHeight: storedWidth,
  };
}

/**
 * Splices a minimal APP1/EXIF segment (TIFF header + a single IFD0 entry:
 * tag 0x0112 Orientation, type SHORT, count 1) right after the JPEG's SOI
 * marker, per the EXIF 2.3 / TIFF 6.0 structure — the standard tag a real
 * phone photo carries when shot in a non-default rotation.
 */
function injectExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG (missing SOI marker).");
  }

  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  let o = 0;
  tiff.write("II", o); // little-endian
  o += 2;
  tiff.writeUInt16LE(42, o);
  o += 2;
  tiff.writeUInt32LE(8, o); // offset to IFD0, relative to the TIFF header
  o += 4;
  tiff.writeUInt16LE(1, o); // 1 directory entry
  o += 2;
  tiff.writeUInt16LE(0x0112, o); // Orientation
  o += 2;
  tiff.writeUInt16LE(3, o); // type SHORT
  o += 2;
  tiff.writeUInt32LE(1, o); // count
  o += 4;
  tiff.writeUInt16LE(orientation, o); // value, in the first 2 bytes of this field
  o += 4;
  tiff.writeUInt32LE(0, o); // next IFD offset (none)

  const app1Payload = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const app1Length = Buffer.alloc(2);
  app1Length.writeUInt16BE(app1Payload.length + 2, 0); // includes itself

  return Buffer.concat([
    jpeg.subarray(0, 2), // SOI
    Buffer.from([0xff, 0xe1]), // APP1 marker
    app1Length,
    app1Payload,
    jpeg.subarray(2),
  ]);
}

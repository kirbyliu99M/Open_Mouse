/**
 * v3.4 card reference (candidate 未拍板): the browser half of a card-mode
 * photo. Decodes the shot, runs the scan's own full-resolution hand
 * detector (MediaPipe, IMAGE mode, in this tab) and hands the pixels to
 * `analyseCardPhoto`. The photo never leaves the browser.
 */
import { detectHandLandmarks } from "../photo/landmarks";
import {
  analyseCardPhoto,
  type CardPhotoInput,
  type CardPhotoOutcome,
} from "./cardPhoto";

export async function runCardPhoto(
  file: Blob,
  rest: Omit<CardPhotoInput, "image" | "hand">,
): Promise<CardPhotoOutcome> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    // Throws `HandLandmarkerLoadError` when the model cannot load: the
    // caller reports it as the paper path does.
    const found = await detectHandLandmarks(bitmap);
    return analyseCardPhoto({
      ...rest,
      image: { width: data.width, height: data.height, data: data.data },
      hand: found
        ? {
            landmarksPx: found.landmarksPx,
            handedness: found.handedness,
            confidence: found.confidence,
          }
        : null,
    });
  } finally {
    bitmap.close();
  }
}

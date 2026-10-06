/**
 * The insurance for a preview that is still narrower than the photo (scan v2
 * field-of-view fix). `previewConstraints.ts` asks the camera for a preview in
 * the photo's own shape; a phone that only gives 16:9 leaves the photo showing
 * more than the preview did, and the sheet the person framed fills only part of
 * it. When the two shapes differ, the photo is cropped, before anything looks
 * at it, to the middle of the photo with the preview's shape: the field of view
 * the person was shown.
 *
 * This assumes the preview is a centred crop of the photo's field of view,
 * which is how a camera produces a 16:9 video frame from a 4:3 sensor. It is
 * the same assumption the frozen photo's crop already makes
 * (`computeStillCrop`, photoLayout.ts). Not verified on a phone.
 *
 * What the crop must not damage is the parallax correction. It reads the
 * photo's EXIF focal length in pixels, which is worked out from the size of
 * the *whole* decoded photo (`estimateFocalFromExif`), and takes the image
 * centre as the principal point. Cropping does not change a lens's focal
 * length in pixels, so the focal length is still taken from the whole photo
 * (pipeline.ts passes it the uncropped size). The principal point stays at the
 * centre because the crop is centred: `computeFovCrop` returns a rectangle
 * with the same margin on both sides, to the pixel, so its centre is the
 * photo's centre exactly (tested). The overlay the pipeline reports is moved
 * back into the whole photo's pixels (`toFullFrame`), so nothing downstream
 * sees a cropped coordinate.
 */
import { CAMERA_CONSTANTS } from "./constants";

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in whole pixels. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function usable(size: FrameSize | null | undefined): size is FrameSize {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

const upright = (size: FrameSize) => size.height > size.width;

/**
 * The part of `still` that shows what `preview` showed, in the still's whole
 * pixels, or `null` when the photo should be analysed as it is: the two are
 * the same shape within the tolerance (2 %), or they are not both upright (or
 * both wide), or the preview was the *wider* view of the two (cropping the
 * photo cannot bring back what it does not show).
 *
 * The crop keeps the photo's long edge whole and trims its short edge, the same
 * margin on both sides, to the preview's shape. An odd leftover pixel is
 * trimmed too, so the margins are equal and the centre does not move.
 */
export function computeFovCrop(
  still: FrameSize,
  preview: FrameSize | null | undefined,
  tolerance: number = CAMERA_CONSTANTS.preview.fovMismatchTolerance,
): PixelRect | null {
  if (!usable(still) || !usable(preview)) return null;
  if (upright(still) !== upright(preview)) return null;
  if (still.width === still.height && preview.width === preview.height)
    return null;
  const stillElongation =
    Math.max(still.width, still.height) / Math.min(still.width, still.height);
  const previewElongation =
    Math.max(preview.width, preview.height) /
    Math.min(preview.width, preview.height);
  // The preview was no narrower than the photo: nothing to cut away.
  if (previewElongation <= stillElongation * (1 + tolerance)) return null;

  if (upright(still)) {
    // Upright: the short edge is the width.
    const target = Math.floor(still.height / previewElongation);
    const width = evenMarginSize(still.width, target);
    return {
      x: (still.width - width) / 2,
      y: 0,
      width,
      height: still.height,
    };
  }
  const target = Math.floor(still.width / previewElongation);
  const height = evenMarginSize(still.height, target);
  return {
    x: 0,
    y: (still.height - height) / 2,
    width: still.width,
    height,
  };
}

/** `target`, at least 1 and at most `full`, with `full - result` even so both margins are the same whole number. */
function evenMarginSize(full: number, target: number): number {
  const size = Math.min(full, Math.max(1, target));
  return (full - size) % 2 === 0 ? size : Math.max(1, size - 1);
}

/** A point in the cropped photo, in the whole photo's pixels. `crop` is `null` for a photo that was not cropped. */
export function toFullFrame(
  point: { readonly x: number; readonly y: number },
  crop: PixelRect | null,
): { x: number; y: number } {
  return crop
    ? { x: point.x + crop.x, y: point.y + crop.y }
    : { x: point.x, y: point.y };
}

/**
 * Which frame each part of the parallax correction reads, for a photo of size
 * `decoded` that was cropped to `crop` (or not, `null`). The pipeline asks
 * here rather than deciding in place, so the rule is written once and tested:
 *
 * - `focalFrame` is what the EXIF focal length in pixels is worked out from:
 *   always the whole decoded photo, because the 35 mm equivalent refers to the
 *   whole frame and cropping does not change a focal length in pixels.
 * - `principalFrame` is the frame whose centre is the principal point: the
 *   image that is actually analysed. For a centred crop that centre is the
 *   whole photo's centre.
 */
export function analysisFrames(
  decoded: FrameSize,
  crop: PixelRect | null,
): { focalFrame: FrameSize; principalFrame: FrameSize } {
  return {
    focalFrame: { width: decoded.width, height: decoded.height },
    principalFrame: crop
      ? { width: crop.width, height: crop.height }
      : { width: decoded.width, height: decoded.height },
  };
}

/** The centre of a rectangle, for the "the crop keeps the principal point" check. */
export function rectCentre(rect: PixelRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

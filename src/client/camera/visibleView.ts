/**
 * What you see is what is analysed (scan v2 field-of-view fix).
 *
 * The viewfinder is the whole screen and shows the camera stream with
 * `object-fit: cover`, so on a tall, narrow phone screen the stream's left and
 * right are cut off: a 390x844 screen shows only about 62 % of the width of a
 * 3:4 stream (82 % of a 9:16 one). The live detector, the cue ("Move closer",
 * "perfect") and the photo's analysis used to look at the WHOLE stream or photo,
 * so a sheet could be "found", "perfect" and even cropped by the screen's edge
 * with its corners out of view, and the photo it came from showed a sheet much
 * smaller than the one on the screen (Kirby's Samsung S25 run, 2026-10-06: the
 * same thing seen from the other side). Now everything looks at the part the
 * person sees:
 *
 * - `visibleRectInStream`: the on-screen part of the stream, in the stream's
 *   pixels. The live detector samples exactly this (`drawImage` with a source
 *   rectangle), so its corner coordinates are the screen's and its width
 *   fractions are the screen's.
 * - `visibleRectInStill`: the same region in the photo from `takePhoto()` (or
 *   in the canvas frame). The photo is cropped to it before anything is
 *   detected.
 *
 * The photo and the stream are related by one model: the stream is a centred
 * part of the photo's field of view (a 16:9 video frame is cut out of a 4:3
 * sensor's middle), or the same field of view. It holds when the stream is the
 * narrower view, or the same; when the stream is the WIDER view it cannot hold
 * and `modelApplies` says so (the region is then worked out in proportion,
 * as if the two showed the same field of view). Not verified on a phone: the
 * attempt log records what was used.
 *
 * What the crop must not damage is the parallax correction. It reads the photo's
 * EXIF focal length in pixels, worked out from the size of the WHOLE decoded
 * photo (`estimateFocalFromExif`), and takes the image centre as the principal
 * point. Cropping does not change a lens's focal length in pixels, so the focal
 * length is still taken from the whole photo (`analysisFrames`). The principal
 * point stays at the centre because the crop is centred: the visible region is
 * centred in the stream (a cover crop trims equally on both sides), the stream
 * is centred in the photo, and `visibleRectInStill` returns whole-pixel margins
 * that are equal on both sides (tested). The overlay the pipeline reports is
 * moved back into the whole photo's pixels (`toFullFrame`).
 */
import { CAMERA_CONSTANTS } from "./constants";
import { computeCoverRect } from "./quad";
import { assumedFocalPxFromFov } from "../paper/orientation";

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle; whole pixels where it is in a photo, fractional where it is in a stream. */
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

function usableRect(rect: PixelRect | null | undefined): rect is PixelRect {
  return (
    !!rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

const upright = (size: FrameSize) => size.height > size.width;
const elongation = (size: FrameSize) =>
  Math.max(size.width, size.height) / Math.min(size.width, size.height);

/**
 * The part of a stream that shows on screen when the stream fills `container`
 * with `object-fit: cover`: in the stream's own pixels, centred, with the
 * container's shape (so it is the whole stream on the axis that fits and a
 * middle slice on the other). `null` for a size that is missing or not positive.
 */
export function visibleRectInStream(
  stream: FrameSize | null | undefined,
  container: FrameSize | null | undefined,
): PixelRect | null {
  if (!usable(stream) || !usable(container)) return null;
  const cover = computeCoverRect(
    container.width,
    container.height,
    stream.width,
    stream.height,
  );
  // Stream pixels per container pixel is the same on both axes under cover.
  const unit = stream.width / cover.width;
  const clamp = (value: number, max: number) =>
    Math.min(max, Math.max(0, value));
  const x = clamp(-cover.x * unit, stream.width);
  const y = clamp(-cover.y * unit, stream.height);
  return {
    x,
    y,
    width: Math.min(stream.width - x, container.width * unit),
    height: Math.min(stream.height - y, container.height * unit),
  };
}

export interface VisibleRegion {
  /** On screen, in the stream's pixels (fractional): what the live detector samples. */
  readonly visible: PixelRect;
  /** The same region in whole pixels, inside the stream: what a captured frame is cut to. */
  readonly capture: PixelRect;
}

/**
 * The on-screen part of the stream, for the two things that must use the SAME
 * one: the live detector's sample (`visible`, fractional) and the frame the
 * shutter takes (`capture`, whole pixels, each edge rounded to the nearest
 * pixel and kept inside the stream). Both come from this one call, so what is
 * analysed is exactly what was approved. `null` for a size that is missing.
 */
export function visibleRegionInStream(
  stream: FrameSize | null | undefined,
  container: FrameSize | null | undefined,
): VisibleRegion | null {
  const visible = visibleRectInStream(stream, container);
  if (!visible || !stream) return null;
  const left = Math.min(stream.width - 1, Math.max(0, Math.round(visible.x)));
  const top = Math.min(stream.height - 1, Math.max(0, Math.round(visible.y)));
  const right = Math.min(
    stream.width,
    Math.max(left + 1, Math.round(visible.x + visible.width)),
  );
  const bottom = Math.min(
    stream.height,
    Math.max(top + 1, Math.round(visible.y + visible.height)),
  );
  return {
    visible,
    capture: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

/** The arguments of `drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)` that copy a capture rectangle 1:1 onto a canvas of its own size. */
export function frameDrawArgs(capture: PixelRect): {
  readonly source: readonly [number, number, number, number];
  readonly destination: readonly [number, number, number, number];
  readonly canvas: FrameSize;
} {
  return {
    source: [capture.x, capture.y, capture.width, capture.height],
    destination: [0, 0, capture.width, capture.height],
    canvas: { width: capture.width, height: capture.height },
  };
}

/** `target` rounded down and kept within 1..`full`. */
function clampedSize(full: number, target: number): number {
  return Math.min(full, Math.max(1, Math.floor(target)));
}

/**
 * One axis of a region, in whole pixels. A region centred on the photo gets
 * equal margins to the pixel (`start` rounded up, so the region shrinks rather
 * than grows) so its centre is the photo's centre exactly; anything else is
 * rounded as it comes.
 */
function wholeSpan(
  start: number,
  size: number,
  full: number,
): { start: number; size: number } {
  const maxMargin = Math.floor((full - 1) / 2);
  if (Math.abs(start + size / 2 - full / 2) <= 1) {
    const margin = Math.min(maxMargin, Math.max(0, Math.ceil(start - 1e-6)));
    return { start: margin, size: full - 2 * margin };
  }
  const first = Math.min(full - 1, Math.max(0, Math.round(start)));
  const last = Math.min(full, Math.max(first + 1, Math.round(start + size)));
  return { start: first, size: last - first };
}

export type ViewModel =
  /** The stream and the photo show the same field of view (their shapes agree within the tolerance). */
  | "same-view"
  /** The stream is the narrower view: a centred part of the photo (a 16:9 frame from a 4:3 sensor). */
  | "stream-in-still"
  /** The stream is the WIDER view: it cannot be a part of the photo, the model does not hold. */
  | "stream-wider"
  /** One is upright and the other wide: not matched, the whole photo is analysed. */
  | "orientation-differs";

export interface VisibleInStill {
  /** The on-screen region in the photo's whole pixels; `null` when it is the whole photo (or cannot be worked out). */
  readonly crop: PixelRect | null;
  readonly model: ViewModel;
  /** The centred-part model holds. */
  readonly modelApplies: boolean;
  /** (stream - photo) / photo, in long over short; positive when the stream is the narrower view. */
  readonly aspectDiff: number;
}

/**
 * The region of the photo that was on screen: `visibleInStream` (from
 * `visibleRectInStream`) carried over through the model in the file header.
 * `still` is the photo as it will be analysed (decoded, oriented, possibly
 * scaled down; only its shape matters). `null` for sizes that are missing or
 * not positive.
 */
export function visibleRectInStill(
  still: FrameSize | null | undefined,
  stream: FrameSize | null | undefined,
  visibleInStream: PixelRect | null | undefined,
  tolerance: number = CAMERA_CONSTANTS.preview.fovMismatchTolerance,
): VisibleInStill | null {
  if (!usable(still) || !usable(stream) || !usableRect(visibleInStream))
    return null;
  const stillElongation = elongation(still);
  const streamElongation = elongation(stream);
  const aspectDiff = (streamElongation - stillElongation) / stillElongation;
  const whole = { x: 0, y: 0, width: still.width, height: still.height };

  if (upright(still) !== upright(stream)) {
    return {
      crop: null,
      model: "orientation-differs",
      modelApplies: false,
      aspectDiff,
    };
  }

  let container: PixelRect = whole;
  let model: ViewModel = "same-view";
  let modelApplies = true;
  if (Math.abs(aspectDiff) > tolerance) {
    if (aspectDiff > 0) {
      model = "stream-in-still";
      // The photo's middle with the stream's shape.
      const streamWide = stream.width / stream.height;
      if (still.width / still.height > streamWide) {
        const width = clampedSize(still.width, still.height * streamWide);
        container = {
          x: (still.width - width) / 2,
          y: 0,
          width,
          height: still.height,
        };
      } else {
        const height = clampedSize(still.height, still.width / streamWide);
        container = {
          x: 0,
          y: (still.height - height) / 2,
          width: still.width,
          height,
        };
      }
    } else {
      model = "stream-wider";
      modelApplies = false;
    }
  }

  const left =
    container.x + (visibleInStream.x / stream.width) * container.width;
  const top =
    container.y + (visibleInStream.y / stream.height) * container.height;
  const width = (visibleInStream.width / stream.width) * container.width;
  const height = (visibleInStream.height / stream.height) * container.height;
  const columns = wholeSpan(left, width, still.width);
  const rows = wholeSpan(top, height, still.height);
  const isWhole =
    columns.start === 0 &&
    rows.start === 0 &&
    columns.size === still.width &&
    rows.size === still.height;
  return {
    crop: isWhole
      ? null
      : {
          x: columns.start,
          y: rows.start,
          width: columns.size,
          height: rows.size,
        },
    model,
    modelApplies,
    aspectDiff,
  };
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
 * Which frame each part of the analysis reads, for a photo of size `decoded`
 * that was cropped to `crop` (or not, `null`). The pipeline asks here rather
 * than deciding in place, so the rule is written once and tested:
 *
 * - `focalFrame` is what a focal length in pixels is worked out from, the EXIF
 *   one and the assumed one the paper detector falls back on: always the whole
 *   decoded photo, because a 35 mm equivalent refers to the whole frame and
 *   cropping does not change a focal length in pixels.
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

/**
 * The focal length in pixels the paper detector assumes when the photo has none
 * of its own (a 70 degree horizontal field of view over the frame's width),
 * taken from the whole decoded photo's width and not the cropped one's: a crop
 * narrows the picture, not the lens.
 */
export function assumedDetectionFocalPx(frames: {
  focalFrame: FrameSize;
}): number {
  return assumedFocalPxFromFov(frames.focalFrame.width);
}

/**
 * The focal length in pixels the paper detector assumes for the live loop's
 * sample (a 70 degree horizontal field of view over the width of the WHOLE
 * stream, scaled to the sample's pixels). The sample is the visible part of the
 * stream shrunk to `sample`, so one stream pixel is `sample.width /
 * visible.width` sample pixels. Taking the assumption from the sample's own
 * width instead would say the narrower picture is a wider view. With the whole
 * stream as the visible part it is the same number as before.
 */
export function assumedSampleFocalPx(
  stream: FrameSize,
  visible: PixelRect,
  sample: FrameSize,
): number {
  return assumedFocalPxFromFov(stream.width) * (sample.width / visible.width);
}

/** The centre of a rectangle, for the "the crop keeps the principal point" check. */
export function rectCentre(rect: PixelRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

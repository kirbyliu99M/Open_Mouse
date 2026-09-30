/**
 * Layout maths for the easy scan's fixed stage
 * (docs/design/scan-v2-2026-09-30/README.md, "Stage", "Capture and freeze",
 * "Measured"). The stage is the whole screen and never changes size; what
 * changes is what is drawn in it. All of it is pure.
 *
 * - `computeGuideRect`: the fixed rectangle the corner dots sit on until the
 *   paper's corners are found.
 * - `computeFrozenPhotoLayout`: where the captured photo goes, so that the
 *   frozen picture occupies exactly the rectangle and crop the last live
 *   frame had. The live `<video>` is `object-fit: cover`; the still from
 *   `takePhoto()` has a different aspect ratio (a 4:3 still against a 16:9
 *   preview, in portrait: the same height, more width), so it is cropped to
 *   the stream's aspect ratio first and then covers the stage exactly as the
 *   video did.
 * - `computeMeasuredTransform`: the scale and move (a transform, nothing
 *   else) that lift the photo clear of the bottom sheet.
 */
import {
  PAPER_SIZES_MM,
  type PaperSize,
} from "../../lib/contracts/measurement";
import {
  computeContainRect,
  computeCoverRect,
  type Point,
  type Rect,
} from "./quad";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the corner dots sit until the paper is found. */
export const GUIDE_INSETS = {
  /** Space above the guide: the top bar and the cue line. */
  topPx: 150,
  /** Space below the guide: the hint line and the shutter row. */
  bottomPx: 190,
  /** The guide's width as a fraction of the stage width. */
  widthFraction: 0.85,
} as const;

/** The paper's height over its width, for the guide's shape. */
export function paperAspect(paperSize: PaperSize): number {
  const { width, height } = PAPER_SIZES_MM[paperSize];
  return height / width;
}

/**
 * The guide rectangle: a portrait sheet of the given `aspect` (height over
 * width) centred in the band between the top and bottom insets. It shrinks to
 * fit a short stage, and falls back to the whole stage when the band is gone
 * (landscape). Same inputs, same rectangle: the guide never moves on its own.
 */
export function computeGuideRect(
  stage: Size,
  aspect: number,
  insets: typeof GUIDE_INSETS = GUIDE_INSETS,
): Rect {
  if (stage.width <= 0 || stage.height <= 0 || aspect <= 0) {
    throw new RangeError(
      "computeGuideRect needs a positive stage size and aspect.",
    );
  }
  const bandTop = insets.topPx;
  const bandHeight = stage.height - insets.topPx - insets.bottomPx;
  if (bandHeight < stage.height * 0.3) {
    // No room for the bars: the guide is the stage, inset a little.
    const margin = Math.min(stage.width, stage.height) * 0.08;
    return {
      x: margin,
      y: margin,
      width: stage.width - 2 * margin,
      height: stage.height - 2 * margin,
    };
  }
  const width = Math.min(
    stage.width * insets.widthFraction,
    bandHeight / aspect,
  );
  const height = width * aspect;
  return {
    x: (stage.width - width) / 2,
    y: bandTop + (bandHeight - height) / 2,
    width,
    height,
  };
}

/** The four corners of a rectangle, TL, TR, BR, BL. */
export function rectCorners(rect: Rect): readonly [Point, Point, Point, Point] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

const ASPECT_EPSILON = 0.001;

/**
 * The part of a still, in the still's own pixels, that shows what the stream
 * showed: the largest centred rectangle of the still with the stream's aspect
 * ratio. The whole still when the aspect ratios already match.
 */
export function computeStillCrop(stream: Size, still: Size): Rect {
  const streamAspect = stream.width / stream.height;
  const stillAspect = still.width / still.height;
  if (Math.abs(streamAspect - stillAspect) < ASPECT_EPSILON) {
    return { x: 0, y: 0, width: still.width, height: still.height };
  }
  if (stillAspect > streamAspect) {
    // The still is relatively wider: same height, less width.
    const width = still.height * streamAspect;
    return {
      x: (still.width - width) / 2,
      y: 0,
      width,
      height: still.height,
    };
  }
  // The still is relatively taller: same width, less height.
  const height = still.width / streamAspect;
  return {
    x: 0,
    y: (still.height - height) / 2,
    width: still.width,
    height,
  };
}

export interface FrozenPhotoLayout {
  /** Where the photo (its `crop`) is drawn, in stage pixels. May run past the stage; the stage clips it. */
  readonly box: Rect;
  /** The part of the still that is drawn, in the still's pixels. */
  readonly crop: Rect;
}

function isPortrait(size: Size): boolean {
  return size.height > size.width;
}

/**
 * The frozen photo's box and crop.
 *
 * With a live stream behind it, the box is the rectangle the video covered
 * (`object-fit: cover` of the stream in the stage) and the crop is the part
 * of the still the stream showed, so the picture does not change shape or
 * shift at the moment of capture. A photo from the upload button has no
 * stream to match, and a still whose orientation disagrees with the
 * stream's cannot be matched: both are shown whole, fitted inside the stage.
 */
export function computeFrozenPhotoLayout(input: {
  readonly stage: Size;
  readonly stream: Size | null;
  readonly still: Size;
}): FrozenPhotoLayout {
  const { stage, stream, still } = input;
  if (
    stage.width <= 0 ||
    stage.height <= 0 ||
    still.width <= 0 ||
    still.height <= 0
  ) {
    throw new RangeError(
      "computeFrozenPhotoLayout needs a positive stage and still size.",
    );
  }
  const whole: Rect = { x: 0, y: 0, width: still.width, height: still.height };
  if (
    stream &&
    stream.width > 0 &&
    stream.height > 0 &&
    isPortrait(stream) === isPortrait(still)
  ) {
    return {
      box: computeCoverRect(
        stage.width,
        stage.height,
        stream.width,
        stream.height,
      ),
      crop: computeStillCrop(stream, still),
    };
  }
  return {
    box: computeContainRect(
      stage.width,
      stage.height,
      still.width,
      still.height,
    ),
    crop: whole,
  };
}

/** Maps a point in the still's pixels to stage pixels through a layout. */
export function photoPointToStage(
  point: Point,
  layout: FrozenPhotoLayout,
): Point {
  const { box, crop } = layout;
  return {
    x: box.x + ((point.x - crop.x) / crop.width) * box.width,
    y: box.y + ((point.y - crop.y) / crop.height) * box.height,
  };
}

/** The smallest rectangle around the points; `null` for none. */
export function boundingRect(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

/** Grows a rectangle by `by` on every side. */
export function padRect(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  };
}

export const MEASURED_LAYOUT = {
  /** The photo is shown at this scale once it is measured. */
  photoScale: 0.9,
  /** The photo's content stays below this line (the close and hand buttons). */
  topInsetPx: 88,
  /** ...and this far above the bottom sheet. */
  sheetGapPx: 24,
} as const;

export interface MeasuredTransform {
  readonly scale: number;
  /** Pixels; negative moves the photo up. */
  readonly translateY: number;
}

/**
 * The transform that clears the photo of the bottom sheet: scale about the
 * stage centre (`transform-origin: 50% 50%`), then move vertically so that
 * `focus` (the paper, the hand and their labels, in untransformed stage
 * pixels) sits centred in the band between the top inset and the sheet.
 * The scale is `photoScale`, or smaller when `focus` would not fit the band
 * at that scale. The CSS is `translateY(ty) scale(s)`.
 */
export function computeMeasuredTransform(input: {
  readonly stage: Size;
  readonly focus: Rect;
  /** Distance from the stage top to the sheet's top edge. */
  readonly sheetTop: number;
  readonly layout?: typeof MEASURED_LAYOUT;
}): MeasuredTransform {
  const { stage, focus, sheetTop } = input;
  const layout = input.layout ?? MEASURED_LAYOUT;
  const bandTop = layout.topInsetPx;
  const bandBottom = Math.max(bandTop + 1, sheetTop - layout.sheetGapPx);
  const bandHeight = bandBottom - bandTop;
  const scale =
    focus.height > 0
      ? Math.min(layout.photoScale, bandHeight / focus.height)
      : layout.photoScale;
  const centreY = stage.height / 2;
  const scaledTop = centreY + scale * (focus.y - centreY);
  const scaledBottom = centreY + scale * (focus.y + focus.height - centreY);
  const translateY =
    (bandTop + bandBottom) / 2 - (scaledTop + scaledBottom) / 2;
  return { scale, translateY };
}

/** Where a stage-pixel point ends up under a `MeasuredTransform`. */
export function applyMeasuredTransform(
  point: Point,
  stage: Size,
  transform: MeasuredTransform,
): Point {
  const cx = stage.width / 2;
  const cy = stage.height / 2;
  return {
    x: cx + transform.scale * (point.x - cx),
    y: cy + transform.translateY + transform.scale * (point.y - cy),
  };
}

/**
 * What must stay clear of the bottom sheet once a photo has been measured
 * (or has failed): the paper's corners and the hand's landmarks, with room
 * around them for the dimension lines and their labels, in untransformed
 * stage pixels. With neither, the visible part of the photo itself.
 */
export function computeResultFocusRect(input: {
  readonly stage: Size;
  readonly layout: FrozenPhotoLayout;
  /** Still pixels per overlay pixel (the pipeline may have scaled the photo down). */
  readonly overlayToStill: number;
  readonly overlay: {
    readonly landmarksPx: readonly Point[] | null;
    readonly paperCorners?: readonly Point[] | null;
  } | null;
  /** Room for the labels around the points, in stage pixels. */
  readonly labelAllowancePx: number;
}): Rect {
  const { stage, layout, overlayToStill, overlay } = input;
  const overlayPoints = [
    ...(overlay?.paperCorners ?? []),
    ...(overlay?.landmarksPx ?? []),
  ];
  const stagePoints = overlayPoints.map((p) =>
    photoPointToStage(
      { x: p.x * overlayToStill, y: p.y * overlayToStill },
      layout,
    ),
  );
  const around = boundingRect(stagePoints);
  if (around) return padRect(around, input.labelAllowancePx);
  const left = Math.max(0, layout.box.x);
  const top = Math.max(0, layout.box.y);
  const right = Math.min(stage.width, layout.box.x + layout.box.width);
  const bottom = Math.min(stage.height, layout.box.y + layout.box.height);
  if (right <= left || bottom <= top) {
    return { x: 0, y: 0, width: stage.width, height: stage.height };
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Overlay units per on-screen pixel for a drawn photo: the size in the
 * pipeline's own pixels of one screen pixel, once the layer is at
 * `layerScale`. Fixed-size parts of the drawing (label text, corner checks)
 * are multiplied by it so they look the same whatever the photo's resolution.
 */
export function overlayUnitsPerPx(
  layout: FrozenPhotoLayout,
  overlayToStill: number,
  layerScale: number,
): number {
  return (
    1 / (overlayToStill * (layout.box.width / layout.crop.width) * layerScale)
  );
}

/**
 * The preview stream in the shape of the photo (scan v2 field-of-view fix).
 *
 * Kirby's Android Chrome run (Samsung S25, 2026-10-06): the live preview was
 * perfect (four corners, steady, ring full) and the photo taken from it was
 * rejected. The preview stream was 1080x1920 (9:16) and the photo from
 * `takePhoto()` was 3000x4000 (3:4). Asking for 1920x1080 gets a phone's 16:9
 * video mode, which crops the sensor's sides (in portrait); `takePhoto()` reads
 * the whole 4:3 sensor. The photo therefore shows about a third more across
 * than the preview did, and a sheet that filled the preview filled only about
 * three quarters of the photo's width. (An inference from those numbers, not
 * confirmed on the phone.)
 *
 * The fix is to ask for a preview with the photo's own aspect ratio. The photo's
 * shape is read from `ImageCapture.getPhotoCapabilities()` (the largest
 * `imageWidth` and `imageHeight`); where the camera will not say, a 4:3 sensor
 * is assumed. Everything here is pure except `alignPreviewToStill`, which takes
 * the track and the `ImageCapture` constructor as arguments so a fake can stand
 * in for them.
 *
 * Nothing here can be verified without the phone: a browser may still answer
 * with another shape. `compareFov` is how the app finds out and says so (the
 * debug panel and the attempt log, attemptLog.ts), and `fovCrop.ts` is the
 * fallback for when it does.
 */
import { CAMERA_CONSTANTS } from "./constants";

const PREVIEW = CAMERA_CONSTANTS.preview;

/** The widest and narrowest long-over-short ratio taken at face value; anything else is a camera reporting nonsense. */
const MIN_ASPECT = 1;
const MAX_ASPECT = 3;

/** The size part of the preview's video constraints (no `facingMode`, which cannot be re-applied to a running track). */
export interface PreviewSizing {
  readonly width: { readonly ideal: number };
  readonly height: { readonly ideal: number };
  readonly aspectRatio: { readonly ideal: number };
  /**
   * Prefer the camera's own frame sizes over a browser crop-and-scale to the
   * requested shape, which would quietly narrow the field of view.
   */
  readonly resizeMode: { readonly ideal: "none" };
}

export interface PreviewConstraints extends PreviewSizing {
  readonly facingMode: "environment";
}

/**
 * A photo's shape as long edge over short edge (1 or more), whichever way the
 * caller measured it. `null` for anything that is not a usable shape: not a
 * number, not positive, or wilder than 3:1 (no phone camera is).
 */
export function normaliseStillAspect(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  const longOverShort = value >= 1 ? value : 1 / value;
  return longOverShort >= MIN_ASPECT && longOverShort <= MAX_ASPECT
    ? longOverShort
    : null;
}

/** Long edge over short edge of a size; `null` where the size is not usable. */
export function aspectOfSize(width: unknown, height: unknown): number | null {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !(width > 0) ||
    !(height > 0)
  )
    return null;
  return normaliseStillAspect(
    Math.max(width, height) / Math.min(width, height),
  );
}

function evenRound(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

/**
 * The preview's size constraints for a photo of shape `stillAspect` (long over
 * short; 4:3 when unknown or unusable). Short edge about 1080, never asked below
 * 720. `portrait` says which way round the stream is: a phone held upright
 * gives a stream that is taller than it is wide, so its short edge is the
 * width and `aspectRatio` (width over height) is below 1.
 */
export function previewSizingFor(
  stillAspect: number | null | undefined,
  portrait: boolean,
  shortEdgePx: number = PREVIEW.shortEdgePx,
): PreviewSizing {
  const aspect =
    normaliseStillAspect(stillAspect) ?? PREVIEW.defaultStillAspect;
  const short = evenRound(
    Math.max(
      PREVIEW.minShortEdgePx,
      Number.isFinite(shortEdgePx) ? shortEdgePx : PREVIEW.shortEdgePx,
    ),
  );
  const long = evenRound(short * aspect);
  return {
    width: { ideal: portrait ? short : long },
    height: { ideal: portrait ? long : short },
    aspectRatio: { ideal: portrait ? 1 / aspect : aspect },
    resizeMode: { ideal: "none" },
  };
}

/** The full `video` constraints for `getUserMedia`. */
export function previewConstraintsFor(
  stillAspect: number | null | undefined,
  portrait: boolean,
  shortEdgePx?: number,
): PreviewConstraints {
  return {
    facingMode: "environment",
    ...previewSizingFor(stillAspect, portrait, shortEdgePx),
  };
}

/** Which way round the stream will be: a window taller than wide gives an upright stream. */
export function isPortraitViewport(width: number, height: number): boolean {
  return height >= width;
}

/**
 * The photo's shape from what `ImageCapture.getPhotoCapabilities()` returned:
 * the largest `imageWidth` over the largest `imageHeight`, as long over short.
 * `null` when either is missing or unusable.
 */
export function stillAspectFromCapabilities(capabilities: unknown): {
  readonly aspect: number;
  readonly width: number;
  readonly height: number;
} | null {
  if (!capabilities || typeof capabilities !== "object") return null;
  const caps = capabilities as {
    imageWidth?: { max?: unknown };
    imageHeight?: { max?: unknown };
  };
  const width = caps.imageWidth?.max;
  const height = caps.imageHeight?.max;
  const aspect = aspectOfSize(width, height);
  if (aspect === null) return null;
  return { aspect, width: width as number, height: height as number };
}

export interface FovComparison {
  /** The preview's long over short, `null` when its size is not known. */
  readonly previewAspect: number | null;
  /** The photo's long over short that the preview was compared with. */
  readonly stillAspect: number;
  /**
   * (preview - photo) / photo, in long over short: 0 for the same shape,
   * positive when the preview is the narrower view (16:9 against 4:3 is +0.33).
   * `null` when the preview's size is not known.
   */
  readonly aspectDiff: number | null;
  /** The two differ by more than the tolerance (2 %); `null` when not known. */
  readonly fovMismatch: boolean | null;
}

/**
 * Whether the preview and the photo show the same field of view, judged by
 * their shapes. `preview` is the track's `getSettings()` (or the video
 * element's size); `stillAspect` is long over short. A preview with a missing
 * size is "not known", never a mismatch.
 */
export function compareFov(
  preview: { readonly width?: unknown; readonly height?: unknown } | null,
  stillAspect: number,
  tolerance: number = PREVIEW.fovMismatchTolerance,
): FovComparison {
  const previewAspect = preview
    ? aspectOfSize(preview.width, preview.height)
    : null;
  if (previewAspect === null)
    return {
      previewAspect: null,
      stillAspect,
      aspectDiff: null,
      fovMismatch: null,
    };
  const aspectDiff = (previewAspect - stillAspect) / stillAspect;
  return {
    previewAspect,
    stillAspect,
    aspectDiff,
    fovMismatch: Math.abs(aspectDiff) > tolerance,
  };
}

/** The part of a `MediaStreamTrack` the alignment uses. */
export interface PreviewTrackLike {
  getSettings?(): { width?: number; height?: number; frameRate?: number };
  applyConstraints(constraints: PreviewSizing): Promise<void>;
}

export interface ImageCaptureLikeForCapabilities {
  getPhotoCapabilities(): Promise<unknown>;
}
export type ImageCaptureCtorLike<T extends ImageCaptureLikeForCapabilities> =
  new (track: never) => T;

export interface PreviewAlignment {
  /** The sizing the preview was last asked for. */
  readonly requested: PreviewSizing;
  /** The photo's shape that the preview was compared with, long over short. */
  readonly stillAspect: number;
  /** Where that shape came from. */
  readonly stillAspectSource: "photoCapabilities" | "default";
  /** The largest photo size the camera reported, if it did. */
  readonly photoMax: { readonly width: number; readonly height: number } | null;
  /** The second request to the running track, when the photo was not 4:3. `null` when none was needed. */
  readonly reapplied: {
    readonly applied: boolean;
    readonly reason?: string;
  } | null;
  /** What the track reports after that. */
  readonly settings: {
    readonly width: number | null;
    readonly height: number | null;
    readonly frameRate: number | null;
  } | null;
  readonly comparison: FovComparison;
}

function readSettings(track: PreviewTrackLike): PreviewAlignment["settings"] {
  try {
    const settings = track.getSettings?.();
    if (!settings) return null;
    return {
      width: typeof settings.width === "number" ? settings.width : null,
      height: typeof settings.height === "number" ? settings.height : null,
      frameRate:
        typeof settings.frameRate === "number" ? settings.frameRate : null,
    };
  } catch {
    return null;
  }
}

/**
 * Once the stream is running (it was first asked for in the default 4:3 shape,
 * because `ImageCapture` needs a track to ask the camera anything): read the
 * photo's real shape and, when it is not 4:3, ask the running track for that
 * shape instead. Then report what the track gave. Never throws: an
 * `ImageCapture` that is missing, a camera that refuses the question or a track
 * that refuses the constraint all leave the stream as it was and say so in the
 * result.
 */
export async function alignPreviewToStill<
  T extends ImageCaptureLikeForCapabilities,
>(input: {
  readonly track: PreviewTrackLike;
  readonly ImageCaptureCtor: ImageCaptureCtorLike<T> | null;
  readonly portrait: boolean;
}): Promise<PreviewAlignment> {
  const { track, ImageCaptureCtor, portrait } = input;
  let capabilities: ReturnType<typeof stillAspectFromCapabilities> = null;
  if (ImageCaptureCtor) {
    try {
      const capture = new ImageCaptureCtor(input.track as never);
      capabilities = stillAspectFromCapabilities(
        await capture.getPhotoCapabilities(),
      );
    } catch {
      capabilities = null;
    }
  }
  const stillAspect = capabilities?.aspect ?? PREVIEW.defaultStillAspect;
  let requested = previewSizingFor(PREVIEW.defaultStillAspect, portrait);
  let reapplied: PreviewAlignment["reapplied"] = null;
  if (
    capabilities &&
    Math.abs(capabilities.aspect - PREVIEW.defaultStillAspect) /
      PREVIEW.defaultStillAspect >
      PREVIEW.fovMismatchTolerance
  ) {
    const sizing = previewSizingFor(capabilities.aspect, portrait);
    try {
      await track.applyConstraints(sizing);
      requested = sizing;
      reapplied = { applied: true };
    } catch (error) {
      reapplied = {
        applied: false,
        reason: error instanceof Error && error.name ? error.name : "error",
      };
    }
  }
  const settings = readSettings(track);
  return {
    requested,
    stillAspect,
    stillAspectSource: capabilities ? "photoCapabilities" : "default",
    photoMax: capabilities
      ? { width: capabilities.width, height: capabilities.height }
      : null,
    reapplied,
    settings,
    comparison: compareFov(settings, stillAspect),
  };
}

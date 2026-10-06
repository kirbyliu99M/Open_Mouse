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
 * debug panel and the attempt log, attemptLog.ts), and `visibleView.ts` is the
 * fallback for when it does: everything looks at the part the person sees.
 */
import { CAMERA_CONSTANTS } from "./constants";

const PREVIEW = CAMERA_CONSTANTS.preview;

/** The retry with width and height swapped is kept only if it is closer to the photo's shape by more than this (fraction of the photo's). */
const MIN_RETRY_GAIN = 0.005;

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

/**
 * The preview request used while the capture is a frame of the video: 1920x1080
 * ideal in the camera's landscape terms, `resizeMode: none`, no `aspectRatio`.
 * Chrome on Android reads the size as landscape and returns the stream upright
 * (1080x1920 on the S25). Nothing here depends on the photo's shape.
 */
export function framePreviewConstraints(): Omit<
  PreviewConstraints,
  "aspectRatio"
> {
  return {
    facingMode: "environment",
    width: { ideal: PREVIEW.frameIdealWidth },
    height: { ideal: PREVIEW.frameIdealHeight },
    resizeMode: { ideal: "none" },
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
  /**
   * Where that shape came from: the camera's `getPhotoCapabilities()`; the
   * 4:3 assumed because `ImageCapture` exists but would not say; or "canvas",
   * where there is no `ImageCapture` at all, so the photo is a frame grabbed
   * from the preview and is, by construction, the same field of view.
   */
  readonly stillAspectSource: "photoCapabilities" | "default" | "canvas";
  /** The largest photo size the camera reported, if it did. */
  readonly photoMax: { readonly width: number; readonly height: number } | null;
  /** The second request to the running track, when the photo was not 4:3. `null` when none was needed. */
  readonly reapplied: {
    readonly applied: boolean;
    readonly reason?: string;
  } | null;
  /**
   * A phone's browser may read a size request in the sensor's own (wide)
   * orientation rather than the screen's, and so answer an upright 3:4 request
   * with the wrong shape. When the first answer was a mismatch (and no second
   * request had been made, so the track is asked for a size at most twice in
   * all), the same shape was asked for with width and height swapped. `kept`
   * says whether that answer was better (and the right way round) and stayed;
   * otherwise the first request was put back. `null` when there was nothing to
   * try it on.
   */
  readonly orientationRetry: {
    readonly applied: boolean;
    readonly kept: boolean;
    readonly reason?: string;
  } | null;
  /** How many times the running track was asked for a size: 0, 1 or 2. */
  readonly sizeRequests: number;
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

/** How long the camera is given to say what size its photos are, before the preview is taken as it is. */
export const PHOTO_CAPABILITIES_TIMEOUT_MS = 2500;

/** `promise`, or `null` if it has not settled within `ms` (or rejects). */
async function orNullAfter<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const errorName = (error: unknown) =>
  error instanceof Error && error.name ? error.name : "error";

/**
 * Once the stream is running (it was first asked for in the default 4:3 shape,
 * because `ImageCapture` needs a track to ask the camera anything): read the
 * photo's real shape and, when it is not 4:3, ask the running track for that
 * shape instead. Then report what the track gave. At most two size requests are
 * made to the track in all: one for a photo that is not 4:3, or, on a mismatch
 * of a 4:3 photo, the swapped-orientation try and (if it did no better) the
 * request that puts the first one back. Never throws: an `ImageCapture` that is
 * missing, a camera that refuses or does not answer the question or a track
 * that refuses the constraint all leave the stream as it was and say so in the
 * result.
 *
 * Without an `ImageCapture` (the browser takes its photo from the preview with
 * a canvas) the photo can only be the preview's own field of view, so nothing is
 * compared, asked or retried and the result is a match.
 */
export async function alignPreviewToStill<
  T extends ImageCaptureLikeForCapabilities,
>(input: {
  readonly track: PreviewTrackLike;
  readonly ImageCaptureCtor: ImageCaptureCtorLike<T> | null;
  readonly portrait: boolean;
  readonly capabilitiesTimeoutMs?: number;
}): Promise<PreviewAlignment> {
  const { track, ImageCaptureCtor, portrait } = input;
  const first = previewSizingFor(PREVIEW.defaultStillAspect, portrait);

  if (!ImageCaptureCtor) {
    const settings = readSettings(track);
    const previewAspect = settings
      ? aspectOfSize(settings.width, settings.height)
      : null;
    return {
      requested: first,
      stillAspect: previewAspect ?? PREVIEW.defaultStillAspect,
      stillAspectSource: "canvas",
      photoMax: null,
      reapplied: null,
      orientationRetry: null,
      sizeRequests: 0,
      settings,
      comparison: {
        previewAspect,
        stillAspect: previewAspect ?? PREVIEW.defaultStillAspect,
        aspectDiff: 0,
        fovMismatch: false,
      },
    };
  }

  let capabilities: ReturnType<typeof stillAspectFromCapabilities> = null;
  try {
    const capture = new ImageCaptureCtor(track as never);
    capabilities = stillAspectFromCapabilities(
      await orNullAfter(
        capture.getPhotoCapabilities(),
        input.capabilitiesTimeoutMs ?? PHOTO_CAPABILITIES_TIMEOUT_MS,
      ),
    );
  } catch {
    capabilities = null;
  }
  const stillAspect = capabilities?.aspect ?? PREVIEW.defaultStillAspect;
  let requested = first;
  let sizeRequests = 0;
  let reapplied: PreviewAlignment["reapplied"] = null;
  if (
    capabilities &&
    Math.abs(capabilities.aspect - PREVIEW.defaultStillAspect) /
      PREVIEW.defaultStillAspect >
      PREVIEW.fovMismatchTolerance
  ) {
    const sizing = previewSizingFor(capabilities.aspect, portrait);
    sizeRequests += 1;
    try {
      await track.applyConstraints(sizing);
      requested = sizing;
      reapplied = { applied: true };
    } catch (error) {
      reapplied = { applied: false, reason: errorName(error) };
    }
  }
  let settings = readSettings(track);
  let comparison = compareFov(settings, stillAspect);
  let orientationRetry: PreviewAlignment["orientationRetry"] = null;
  // Only when the track has not been asked for a size already: two requests at
  // most (each one can make a phone's camera blink).
  if (
    sizeRequests === 0 &&
    comparison.fovMismatch === true &&
    comparison.aspectDiff !== null
  ) {
    const firstDiff = Math.abs(comparison.aspectDiff);
    const swapped = previewSizingFor(stillAspect, !portrait);
    sizeRequests += 1;
    try {
      await track.applyConstraints(swapped);
      const retrySettings = readSettings(track);
      const retryComparison = compareFov(retrySettings, stillAspect);
      const rightWayRound =
        retrySettings?.width != null &&
        retrySettings.height != null &&
        retrySettings.height > retrySettings.width === portrait;
      const better =
        retryComparison.aspectDiff !== null &&
        Math.abs(retryComparison.aspectDiff) + MIN_RETRY_GAIN < firstDiff;
      if (rightWayRound && better) {
        requested = swapped;
        settings = retrySettings;
        comparison = retryComparison;
        orientationRetry = { applied: true, kept: true };
      } else {
        // No better: the first request goes back, so the preview is what it was.
        sizeRequests += 1;
        try {
          await track.applyConstraints(first);
        } catch {
          // Whatever the track now has is reported below.
        }
        settings = readSettings(track);
        comparison = compareFov(settings, stillAspect);
        orientationRetry = { applied: true, kept: false };
      }
    } catch (error) {
      orientationRetry = {
        applied: false,
        kept: false,
        reason: errorName(error),
      };
    }
  }
  return {
    requested,
    stillAspect,
    stillAspectSource: capabilities ? "photoCapabilities" : "default",
    photoMax: capabilities
      ? { width: capabilities.width, height: capabilities.height }
      : null,
    reapplied,
    orientationRetry,
    sizeRequests,
    settings,
    comparison,
  };
}

/**
 * `alignPreviewToStill` with a limit on how long anything waits for it. The
 * auto-shutter must not stay shut because a camera never answers the photo-size
 * question or a size request: `settled` resolves when the alignment is done or
 * after `settleTimeoutMs` (3 s, a candidate), whichever is first, with
 * `settleTimedOut` saying which. The alignment itself is not abandoned: its
 * result is still delivered through `alignment` whenever it arrives (never a
 * rejection: `null` if it failed).
 */
export function alignAndSettle<T extends ImageCaptureLikeForCapabilities>(
  input: Parameters<typeof alignPreviewToStill<T>>[0] & {
    readonly settleTimeoutMs?: number;
  },
): {
  readonly alignment: Promise<PreviewAlignment | null>;
  readonly settled: Promise<{ readonly settleTimedOut: boolean }>;
} {
  const alignment = alignPreviewToStill(input).catch(() => null);
  const settled = new Promise<{ readonly settleTimedOut: boolean }>(
    (resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ settleTimedOut: true });
      }, input.settleTimeoutMs ?? PREVIEW.settleTimeoutMs);
      void alignment.then(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ settleTimedOut: false });
      });
    },
  );
  return { alignment, settled };
}

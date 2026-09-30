/**
 * Camera focus for the easy scan (docs/design/scan-v2-2026-09-30/README.md,
 * "Focus"). The old stream asked for a size and nothing else, so a phone was
 * left to focus however it liked and a blurry frame had no remedy.
 *
 * On a browser that reports `focusMode` (Android Chrome), the stream is put in
 * continuous focus, and a tap on the paper asks for a single-shot focus at
 * that point. Elsewhere none of this is offered: no reticle, no tap handling.
 *
 * The track is passed in as a small interface so all of it can be tested with
 * a fake one. Every browser call is wrapped: a camera that throws when asked
 * for a constraint it listed must never break the scan.
 *
 * Which support is *reported* differs by browser and is not verified on a real
 * phone yet; `readFocusSupport` returns each source it looked at so the
 * debug panel (`/scan/easy?debug=1`) can show it.
 */
import { computeCoverRect, type Point } from "./quad";

export interface FocusConstraintSet {
  focusMode?: string;
  pointsOfInterest?: { x: number; y: number }[];
}

export interface FocusConstraints {
  advanced: FocusConstraintSet[];
}

/** The part of a `MediaStreamTrack` this module uses. */
export interface FocusTrackLike {
  getCapabilities?(): object;
  getSettings?(): object;
  applyConstraints(constraints: FocusConstraints): Promise<void>;
}

export interface FocusSupport {
  /** `getCapabilities().focusMode`, as a list ([] when not reported). */
  readonly focusModes: readonly string[];
  readonly continuous: boolean;
  readonly singleShot: boolean;
  /**
   * Whether the camera can be given a point to focus on. Chrome lists
   * `pointsOfInterest` in the track's settings and in
   * `getSupportedConstraints()` rather than in `getCapabilities()`, so any of
   * the three counts.
   */
  readonly pointsOfInterest: boolean;
  readonly pointsOfInterestIn: {
    readonly capabilities: boolean;
    readonly settings: boolean;
    readonly supportedConstraints: boolean;
  };
  /** `getCapabilities().zoom`, for the debug panel only (nothing here uses it). */
  readonly zoom: unknown;
  /** A tap can set the focus: single-shot is offered and a point can be given. */
  readonly tapToFocus: boolean;
}

export const NO_FOCUS_SUPPORT: FocusSupport = {
  focusModes: [],
  continuous: false,
  singleShot: false,
  pointsOfInterest: false,
  pointsOfInterestIn: {
    capabilities: false,
    settings: false,
    supportedConstraints: false,
  },
  zoom: undefined,
  tapToFocus: false,
};

function readObject(read: (() => object) | undefined): Record<string, unknown> {
  if (!read) return {};
  try {
    const value = read();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * What the track says it can do about focus. `supportedConstraints` is
 * `navigator.mediaDevices.getSupportedConstraints()` when the caller has it.
 * Never throws.
 */
export function readFocusSupport(
  track: FocusTrackLike,
  supportedConstraints?: object,
): FocusSupport {
  const capabilities = readObject(track.getCapabilities?.bind(track));
  const settings = readObject(track.getSettings?.bind(track));
  const focusMode = capabilities.focusMode;
  const focusModes = Array.isArray(focusMode)
    ? focusMode.filter((m): m is string => typeof m === "string")
    : typeof focusMode === "string"
      ? [focusMode]
      : [];
  const continuous = focusModes.includes("continuous");
  const singleShot = focusModes.includes("single-shot");
  const pointsOfInterestIn = {
    capabilities: "pointsOfInterest" in capabilities,
    settings: "pointsOfInterest" in settings,
    supportedConstraints:
      (supportedConstraints as { pointsOfInterest?: unknown } | undefined)
        ?.pointsOfInterest === true,
  };
  const pointsOfInterest =
    pointsOfInterestIn.capabilities ||
    pointsOfInterestIn.settings ||
    pointsOfInterestIn.supportedConstraints;
  return {
    focusModes,
    continuous,
    singleShot,
    pointsOfInterest,
    pointsOfInterestIn,
    zoom: capabilities.zoom,
    tapToFocus: singleShot && pointsOfInterest,
  };
}

export interface FocusApplyResult {
  /** The browser accepted the constraint. */
  readonly applied: boolean;
  /** Why not: "unsupported" (never asked) or the error's name. */
  readonly reason?: string;
}

function failure(error: unknown): FocusApplyResult {
  return {
    applied: false,
    reason: error instanceof Error && error.name ? error.name : "error",
  };
}

/** Puts the camera in continuous focus when it offers it. Never throws. */
export async function applyContinuousFocus(
  track: FocusTrackLike,
  support: FocusSupport,
): Promise<FocusApplyResult> {
  if (!support.continuous) return { applied: false, reason: "unsupported" };
  try {
    await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    return { applied: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Asks the camera to focus once at `point` (0..1, in the video frame). Never
 * throws; does nothing where a tap cannot set the focus.
 */
export async function applyTapFocus(
  track: FocusTrackLike,
  support: FocusSupport,
  point: Point,
): Promise<FocusApplyResult> {
  if (!support.tapToFocus) return { applied: false, reason: "unsupported" };
  try {
    await track.applyConstraints({
      advanced: [
        {
          focusMode: "single-shot",
          pointsOfInterest: [{ x: point.x, y: point.y }],
        },
      ],
    });
    return { applied: true };
  } catch (error) {
    return failure(error);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Where a tap on the stage falls in the video frame, as 0..1 fractions: the
 * `object-fit: cover` crop is undone, so a tap on the crop's edge maps to the
 * frame's edge, and one on the part of the frame that is cropped away cannot
 * happen. `null` for a stage or frame without a size.
 */
export function tapToVideoPoint(
  tapInStage: Point,
  stage: { readonly width: number; readonly height: number },
  video: { readonly width: number; readonly height: number },
): Point | null {
  if (
    stage.width <= 0 ||
    stage.height <= 0 ||
    video.width <= 0 ||
    video.height <= 0
  )
    return null;
  const cover = computeCoverRect(
    stage.width,
    stage.height,
    video.width,
    video.height,
  );
  return {
    x: clamp01((tapInStage.x - cover.x) / cover.width),
    y: clamp01((tapInStage.y - cover.y) / cover.height),
  };
}

export interface TapFocusHooks {
  /** Called with the outcome of the single-shot request. */
  readonly onTap?: (result: FocusApplyResult) => void;
  /** Called with the outcome of the continuous request that follows. */
  readonly onContinuous?: (result: FocusApplyResult) => void;
}

/**
 * A tap on the paper: focus once at `point`, then, `refocusMs` later (about
 * 1.2 s), go back to continuous focus, so the camera keeps following the
 * scene and does not stay locked on the tapped spot. `cancel()` drops the
 * return to continuous (a new tap, the stream ending). Nothing here throws;
 * a refused single-shot still gets its continuous request.
 */
export function focusOnceThenContinuous(
  track: FocusTrackLike,
  support: FocusSupport,
  point: Point,
  refocusMs: number,
  hooks: TapFocusHooks = {},
): { cancel(): void } {
  void applyTapFocus(track, support, point).then((result) =>
    hooks.onTap?.(result),
  );
  const timer = setTimeout(() => {
    void applyContinuousFocus(track, support).then((result) =>
      hooks.onContinuous?.(result),
    );
  }, refocusMs);
  return { cancel: () => clearTimeout(timer) };
}

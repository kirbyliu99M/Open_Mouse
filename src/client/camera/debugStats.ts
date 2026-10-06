/**
 * Numbers for the scan debug panel (`/scan/easy?debug=1`,
 * docs/design/scan-v2-2026-09-30/README.md, "Debug panel"). It exists so
 * Kirby can run the scan on his own phone and paste back real timings, focus
 * support and sharpness values, from which the candidate thresholds get
 * tuned. Nothing here touches the network and no image is kept: these are
 * plain numbers and short strings, and the only way out of the device is
 * Kirby copying the JSON himself.
 */
import type { AttemptRecord } from "./attemptLog";
import type { CueCode } from "./cues";

/** How many of the latest samples the timing statistics look at. */
export const DEBUG_WINDOW = 30;

/** Appends to a rolling window, keeping the last `max` values. */
export function pushWindow(
  window: readonly number[],
  value: number,
  max: number = DEBUG_WINDOW,
): number[] {
  const next = [...window, value];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Nearest-rank percentile (`p` in 0..100); `null` for no values. */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * Samples per second from the times (ms) of the latest samples: the number of
 * gaps over the time they span. `null` for fewer than two samples.
 */
export function samplesPerSecond(times: readonly number[]): number | null {
  if (times.length < 2) return null;
  const span = times[times.length - 1] - times[0];
  if (span <= 0) return null;
  return ((times.length - 1) / span) * 1000;
}

/**
 * A short user agent: the Android version and model and the browser and its
 * version, e.g. "Android 14; Pixel 8 · Chrome/128". The whole string when it
 * has neither (and cut at 80 characters).
 */
export function shortUserAgent(userAgent: string): string {
  const device = /\((?:Linux; )?(Android [^;)]+(?:; [^;)]+)?)/.exec(userAgent);
  const browser = /(Chrome|CriOS|Firefox|FxiOS|Version)\/(\d+)/.exec(userAgent);
  const parts = [
    device?.[1]?.trim(),
    browser ? `${browser[1]}/${browser[2]}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return (parts.length ? parts.join(" · ") : userAgent).slice(0, 80);
}

const round = (value: number | null, digits: number): number | null =>
  value === null ? null : Number(value.toFixed(digits));

export interface DebugFocusEntry {
  readonly applied: boolean;
  readonly reason?: string;
}

/**
 * The preview's shape against the photo's: what the stream was asked for, what
 * the camera said the photo would be, and whether the two show the same field
 * of view (previewConstraints.ts). `fovMismatch` is the flag the 2026-10-06
 * report is about: a preview 16:9 against a photo 4:3.
 */
export interface DebugPreviewInfo {
  readonly requested: {
    readonly width: number | null;
    readonly height: number | null;
    readonly aspectRatio: number | null;
  } | null;
  /** The photo's long over short that the preview was compared with. */
  readonly stillAspect: number | null;
  readonly stillAspectSource: "photoCapabilities" | "default" | "canvas" | null;
  /** The largest photo size `getPhotoCapabilities()` reported. */
  readonly photoMax: {
    readonly width: number;
    readonly height: number;
  } | null;
  readonly previewAspect: number | null;
  /** (preview - photo) / photo, long over short. */
  readonly aspectDiff: number | null;
  readonly fovMismatch: boolean | null;
  /** The second request made to the running track once the photo's shape was known. */
  readonly reapplied: DebugFocusEntry | null;
  /** The wait for the preview to be asked for the photo's shape ran out (the shutter opened anyway); `null` until it has ended. */
  readonly settleTimedOut: boolean | null;
  /** The same shape asked for with width and height swapped, after a mismatch (previewConstraints.ts). */
  readonly orientationRetry:
    (DebugFocusEntry & { readonly kept: boolean }) | null;
}

export interface ScanDebugSnapshot {
  readonly userAgent: string;
  readonly track: {
    readonly width: number | null;
    readonly height: number | null;
    readonly frameRate: number | null;
    /** The <video> element's own frame size (what object-fit: cover crops). */
    readonly videoWidth: number | null;
    readonly videoHeight: number | null;
  } | null;
  readonly capabilities: {
    readonly focusMode: readonly string[];
    readonly pointsOfInterest: {
      readonly inCapabilities: boolean;
      readonly inSettings: boolean;
      readonly inSupportedConstraints: boolean;
    };
    readonly zoom: unknown;
    readonly tapToFocus: boolean;
  } | null;
  readonly focusApplied: {
    readonly continuous: DebugFocusEntry | null;
    readonly lastTap: DebugFocusEntry | null;
  };
  readonly live: {
    /** The part of the stream the live loop looks at, the part on screen, in the stream's pixels. */
    readonly visibleInStream: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null;
    /** The size of the picture the detector is given. */
    readonly sample: {
      readonly width: number;
      readonly height: number;
    } | null;
    readonly samplesPerSecond: number | null;
    readonly detectionMsAverage: number | null;
    readonly detectionMsP95: number | null;
    readonly laplacianVariance: number | null;
    readonly laplacianFloor: number;
    readonly steady: boolean | null;
    readonly maxCornerMovementFractionOfDiagonal: number | null;
    readonly cornersSeen: number | null;
    /** The raw code of the latest sample. */
    readonly cueCode: CueCode | null;
    /** The code on screen after the debounce. */
    readonly cueShown: CueCode | null;
    readonly ringFraction: number;
    readonly consecutiveFailures: number;
  };
  readonly capture: {
    readonly method: "takePhoto" | "canvas" | "upload" | null;
    readonly stillWidth: number | null;
    readonly stillHeight: number | null;
    readonly stillKb: number | null;
    /** From the ring completing to the frozen picture being on screen. */
    readonly ringCompleteToFrozenMs: number | null;
  };
  readonly preview: DebugPreviewInfo;
  /** The last 20 scan attempts kept on this device (attemptLog.ts), oldest first. Numbers and codes only. */
  readonly attempts: readonly AttemptRecord[];
}

/** The snapshot as pasted back: rounded, stable key order. */
export function debugSnapshotJson(snapshot: ScanDebugSnapshot): string {
  const { live, capture, preview, attempts, ...rest } = snapshot;
  const head = JSON.stringify(
    {
      ...rest,
      preview: {
        ...preview,
        stillAspect: round(preview.stillAspect, 4),
        previewAspect: round(preview.previewAspect, 4),
        aspectDiff: round(preview.aspectDiff, 4),
        requested: preview.requested && {
          ...preview.requested,
          aspectRatio: round(preview.requested.aspectRatio, 4),
        },
      },
      live: {
        ...live,
        visibleInStream: live.visibleInStream && {
          x: round(live.visibleInStream.x, 1),
          y: round(live.visibleInStream.y, 1),
          width: round(live.visibleInStream.width, 1),
          height: round(live.visibleInStream.height, 1),
        },
        samplesPerSecond: round(live.samplesPerSecond, 1),
        detectionMsAverage: round(live.detectionMsAverage, 1),
        detectionMsP95: round(live.detectionMsP95, 1),
        laplacianVariance: round(live.laplacianVariance, 2),
        maxCornerMovementFractionOfDiagonal: round(
          live.maxCornerMovementFractionOfDiagonal,
          4,
        ),
        ringFraction: round(live.ringFraction, 2),
      },
      capture: {
        ...capture,
        stillKb: round(capture.stillKb, 0),
        ringCompleteToFrozenMs: round(capture.ringCompleteToFrozenMs, 0),
      },
    },
    null,
    2,
  );
  // The attempts last, one record to a line: twenty of them, indented like the
  // rest, would be a thousand lines to paste.
  const lines = attempts.map((attempt) => `    ${JSON.stringify(attempt)}`);
  const list = lines.length ? `\n${lines.join(",\n")}\n  ` : "";
  return `${head.slice(0, -2)},\n  "attempts": [${list}]\n}`;
}

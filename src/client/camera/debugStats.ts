/**
 * Numbers for the scan debug panel (`/scan/easy?debug=1`,
 * docs/design/scan-v2-2026-09-30/README.md, "Debug panel"). It exists so
 * Kirby can run the scan on his own phone and paste back real timings, focus
 * support and sharpness values, from which the candidate thresholds get
 * tuned. Nothing here touches the network and no image is kept: these are
 * plain numbers and short strings, and the only way out of the device is
 * Kirby copying the JSON himself.
 */
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

export interface ScanDebugSnapshot {
  readonly userAgent: string;
  readonly track: {
    readonly width: number | null;
    readonly height: number | null;
    readonly frameRate: number | null;
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
}

/** The snapshot as pasted back: rounded, stable key order. */
export function debugSnapshotJson(snapshot: ScanDebugSnapshot): string {
  const { live, capture } = snapshot;
  return JSON.stringify(
    {
      ...snapshot,
      live: {
        ...live,
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
}

/**
 * Reading the hand-detector model with a progress count.
 *
 * `hand_landmarker.task` is 7.8 MB, and MediaPipe's own `modelAssetPath`
 * fetch reports nothing while it runs, so on a slow connection the first scan
 * sat behind an unexplained wait. This module fetches the same same-origin
 * file itself, as a stream, counts the bytes and hands them back as a
 * `Uint8Array` (MediaPipe's `modelAssetBuffer`). Everything here is plain
 * functions over injectable pieces (`fetch`, a `Response`), so it is
 * unit-tested without a browser.
 *
 * The rule for every failure is the same: never make the scan worse than it
 * was. Anything this module cannot do returns `null`, and the caller then
 * lets MediaPipe fetch the file by path, as it did before.
 */

import type { DetectorLoadState } from "./landmarks";

export interface DownloadProgress {
  /** Bytes read so far. */
  readonly loadedBytes: number;
  /** The file's size when the server said so honestly, else null. */
  readonly totalBytes: number | null;
}

/**
 * The size to measure progress against: `Content-Length`, but only when it
 * describes the bytes the stream will yield. A body that is content-encoded
 * (gzip, br) arrives decoded, so its byte count would run past the encoded
 * `Content-Length`; that case, a missing header and a nonsense value all
 * answer null (unknown size, show an indeterminate bar).
 */
export function expectedTotalBytes(
  headers: Pick<Headers, "get">,
): number | null {
  const encoding = headers.get("content-encoding");
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity")
    return null;
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const total = Number(raw.trim());
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

/** 0..1, or null when the total is unknown. Never above 1: a server that
 * sends more than it announced must not show 130%. */
export function progressFraction(progress: DownloadProgress): number | null {
  if (progress.totalBytes === null || progress.totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, progress.loadedBytes / progress.totalBytes));
}

/** Whole percent, rounded down (the bar must not claim 100% before it is). */
export function progressPercent(progress: DownloadProgress): number | null {
  const fraction = progressFraction(progress);
  return fraction === null ? null : Math.floor(fraction * 100);
}

/**
 * The value assistive technology is given: whole percent in coarse steps, so
 * a screen reader that announces value changes speaks a handful of times over
 * the download instead of once per chunk. 100 only when it really is done.
 */
export function announcedPercent(
  progress: DownloadProgress,
  step = 10,
): number | null {
  const percent = progressPercent(progress);
  if (percent === null) return null;
  return Math.min(100, Math.floor(percent / step) * step);
}

/** "3.3" for 3_460_000 bytes: decimal megabytes, one digit. */
export function formatMegabytes(bytes: number): string {
  return (Math.max(0, bytes) / 1_000_000).toFixed(1);
}

export interface DownloadDescription {
  /** True when a percentage is known. */
  readonly determinate: boolean;
  readonly percent: number | null;
  /** The coarse value for `aria-valuenow`; null when indeterminate. */
  readonly announced: number | null;
  /** "3.3 of 7.8 MB" when the total is known, "3.3 MB" when not. */
  readonly sizeText: string;
}

export function describeDownload(
  progress: DownloadProgress,
): DownloadDescription {
  const percent = progressPercent(progress);
  const loaded = formatMegabytes(progress.loadedBytes);
  return {
    determinate: percent !== null,
    percent,
    announced: announcedPercent(progress),
    sizeText:
      progress.totalBytes !== null
        ? `${loaded} of ${formatMegabytes(progress.totalBytes)} MB`
        : `${loaded} MB`,
  };
}

/**
 * Whether a progress reading is worth a re-render: only when the whole
 * percent moved (or, with an unknown total, the tenth of a megabyte), so a
 * stream of 16 KB chunks does not become hundreds of updates.
 */
export function progressChanged(
  previous: DownloadProgress | null,
  next: DownloadProgress,
): boolean {
  if (previous === null) return true;
  if (previous.totalBytes !== next.totalBytes) return true;
  const a = progressPercent(previous);
  const b = progressPercent(next);
  if (a !== null || b !== null) return a !== b;
  return (
    formatMegabytes(previous.loadedBytes) !== formatMegabytes(next.loadedBytes)
  );
}

function concatChunks(chunks: readonly Uint8Array[], length: number) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Fetches `url` and returns its bytes, reporting progress along the way.
 * Returns null on anything that went wrong (a network error, a non-2xx
 * response, a stream that failed midway, an empty body) so the caller can fall
 * back to letting MediaPipe load the model by path. A response with no
 * readable stream (`body` missing or without `getReader`) is read whole with
 * `arrayBuffer()` instead: one request, no progress until it is done.
 */
export async function downloadWithProgress(
  fetchImpl: typeof fetch,
  url: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<Uint8Array | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const totalBytes = expectedTotalBytes(response.headers);
    let last: DownloadProgress | null = null;
    const report = (loadedBytes: number, force = false) => {
      const next = { loadedBytes, totalBytes };
      if (force || progressChanged(last, next)) {
        last = next;
        onProgress(next);
      }
    };
    report(0, true);

    const reader = response.body?.getReader?.();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) return null;
      report(bytes.length, true);
      return bytes;
    }

    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      report(loaded);
    }
    if (loaded === 0) return null;
    // A known total the stream did not reach means it was cut short: do not
    // hand a truncated model to MediaPipe.
    if (totalBytes !== null && loaded !== totalBytes) return null;
    report(loaded, true);
    return concatChunks(chunks, loaded);
  } catch {
    return null;
  }
}

/**
 * What the pill says for a load state, and what assistive technology is told.
 * Pure, so the wording and the coarse announcement steps are unit-tested.
 */
export function describeDetectorLoad(state: DetectorLoadState): {
  readonly visible: boolean;
  readonly text: string;
  /** Sighted-only detail ("3.3 of 7.8 MB"); the bar carries the same for AT. */
  readonly detail: string | null;
  readonly percent: number | null;
  /** `aria-valuenow`: coarse steps, or null for an indeterminate bar. */
  readonly announced: number | null;
} {
  if (state.stage === "model") {
    const d = describeDownload(state);
    return {
      visible: true,
      text: "Loading the hand detector",
      detail: d.sizeText,
      percent: d.percent,
      announced: d.announced,
    };
  }
  if (state.stage === "runtime") {
    // MediaPipe fetches and starts its runtime itself and reports no bytes.
    return {
      visible: true,
      text: "Starting the hand detector",
      detail: null,
      percent: null,
      announced: null,
    };
  }
  return {
    visible: false,
    text: "",
    detail: null,
    percent: null,
    announced: null,
  };
}

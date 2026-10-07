/**
 * The "couldn't read the camera" hint of the easy scan.
 *
 * When the shutter takes a frame of the live video and no frame comes out (the
 * video has no picture yet, the canvas has no 2d context, `toBlob` gives
 * nothing, or the canvas throws), the viewfinder keeps running and the
 * auto-shutter ring refills and tries again. That retry stays silent for the
 * first two failures in a row. From the third on, the cue line says what is
 * happening, and it goes away as soon as one capture works, or the camera is
 * started again or left.
 *
 * Pure: `advanceCaptureFailures` is the whole counting rule, and the component
 * only holds the number. It is not a network message: nothing is uploaded at
 * this point, so the copy does not mention a connection.
 *
 * The copy was approved by Kirby (2026-10-08) and is not to be reworded. There
 * is no i18n framework in the repo yet, so the screen shows English now, as
 * the home story does (src/lib/copy/home-story.ts); the zh-TW line is stored
 * beside it for when the framework lands.
 */

/** Consecutive capture failures before the hint shows (not the first, not the second). */
export const CAPTURE_FAILURE_HINT_THRESHOLD = 3;

/**
 * What happened to a capture attempt. "reset" is the person leaving or
 * cancelling the shutter flow (the camera is asked for again, the length step
 * opens, the photo is taken).
 */
export type CaptureFailureEvent = "failure" | "success" | "reset";

/**
 * The failure count after `event`. A failure counts up, a success or a reset
 * goes back to zero. The count stops at the threshold: past it the number
 * carries no more meaning, and a screen that only re-renders on a change then
 * does not re-render on every further failed attempt.
 */
export function advanceCaptureFailures(
  count: number,
  event: CaptureFailureEvent,
): number {
  if (event === "failure")
    return Math.min(
      Math.max(0, Math.trunc(count)) + 1,
      CAPTURE_FAILURE_HINT_THRESHOLD,
    );
  return 0;
}

/** True from the third consecutive failure until a success or a reset. */
export function shouldShowCaptureFailureHint(count: number): boolean {
  return count >= CAPTURE_FAILURE_HINT_THRESHOLD;
}

/**
 * The line under the viewfinder, with nothing shown while the failure hint is
 * up: the ring keeps refilling during the retries, and "Hold still — taking
 * the photo" would contradict the cue line's "Couldn't read the camera".
 */
export function hintUnderViewfinder(hintText: string, count: number): string {
  return shouldShowCaptureFailureHint(count) ? "" : hintText;
}

export type CaptureFailureLanguage = "en" | "zh-TW";

/** The language the screen shows today (no i18n framework yet). */
export const CAPTURE_FAILURE_HINT_LANGUAGE: CaptureFailureLanguage = "en";

export const CAPTURE_FAILURE_HINT_COPY: Readonly<
  Record<CaptureFailureLanguage, string>
> = {
  en: "Couldn't read the camera. Retrying…",
  "zh-TW": "相機畫面讀取失敗，正在重試…",
};

/** The hint line, in the language the screen shows. */
export function captureFailureHintText(
  language: CaptureFailureLanguage = CAPTURE_FAILURE_HINT_LANGUAGE,
): string {
  return CAPTURE_FAILURE_HINT_COPY[language];
}

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
 * is no i18n framework in the repo yet, so the line follows the browser's
 * preferred language (`pickCaptureFailureLanguage`): zh-TW for a Chinese
 * browser, English otherwise. It is read on the client only, and the hint
 * shows only after failures, so there is no server render to disagree with.
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

/**
 * The language of the hint, from the browser's preferred languages
 * (`navigator.languages`, most preferred first), falling back to the single
 * `navigator.language` when that list is missing or empty. Only the first
 * entry counts: zh-TW when it starts with "zh" (zh-CN and zh-Hant-TW
 * included, as only one Chinese line exists), English otherwise.
 */
export function pickCaptureFailureLanguage(
  languages: readonly string[] | null | undefined,
  language?: string | null,
): CaptureFailureLanguage {
  const first = languages?.length ? languages[0] : language;
  return typeof first === "string" && /^zh(?![a-z])/i.test(first.trim())
    ? "zh-TW"
    : "en";
}

export const CAPTURE_FAILURE_HINT_COPY: Readonly<
  Record<CaptureFailureLanguage, string>
> = {
  en: "Couldn't read the camera. Retrying…",
  "zh-TW": "相機畫面讀取失敗，正在重試…",
};

/**
 * The `lang` attribute for the element showing the hint (WCAG 3.1.2): the
 * page is `lang="en"`, so a zh-TW line needs its own mark. Undefined for
 * English, which leaves the cue's normal text unmarked.
 */
export function captureFailureLangAttribute(
  language: CaptureFailureLanguage,
): string | undefined {
  return language === "zh-TW" ? "zh-TW" : undefined;
}

/** The hint line in `language`. */
export function captureFailureHintText(
  language: CaptureFailureLanguage = "en",
): string {
  return CAPTURE_FAILURE_HINT_COPY[language];
}

/**
 * V3.2 F23 (Kirby's phone test 2026-10-25, candidate / 未拍板): one loader
 * from the last question page to the results, not two. The send veil
 * (`SubmitOverlay`, F13) is the whole page with the particle loader on it;
 * when the scan was stored and `router.push` opens the results, the results
 * page draws its loader at once (not after `FIT_SHOW_AFTER_MS`) at the same
 * spot, with the same words, and from the veil's start, so the ring and the
 * breath go on where they were instead of starting again.
 *
 * What crosses the page switch is held here, in module memory (one tab, a
 * client navigation, so `performance.now()` runs on):
 *   1. the veil notes when its loader started (`noteSendLoaderStart`) while
 *      it is up, and forgets it when it goes (`clearSendLoaderStart`);
 *   2. `useScanSubmit`, just before its `router.push`, ties that start to the
 *      stored scan (`noteLoaderHandoff`); a send with no veil up (the printed
 *      sheet's `ScanSubmitPanel`) ties nothing, so its results page keeps the
 *      300 ms rule;
 *   3. the results page peeks at it for its first frame (`peekLoaderHandoff`,
 *      no side effect, so a render may call it any number of times) and takes
 *      it once in its fit effect (`takeLoaderHandoff`), which clears it
 *      whatever scan it was for.
 * A direct open, a reload, a page reached any other way finds nothing here and
 * keeps the F7 rule: no loader before 300 ms, a quick answer shown at once.
 *
 * Separate from F11's `noteScanHandoff` (resultsHistory.ts), whose meaning (the
 * top bar's back goes back in history) is unchanged.
 */
import { LOADING_TIMING, loaderTimeline } from "@/lib/particles/loading";

/** The veil's loader start while the veil is up (not tied to a scan yet). */
let sendLoaderStart: number | null = null;
/** The start handed to the results page of one scan. */
let handoff: { scanId: string; startedAt: number } | null = null;

/** The send veil is up; its loader started at `startedAt`. */
export function noteSendLoaderStart(startedAt: number): void {
  sendLoaderStart = startedAt;
}

/**
 * The veil with this start is gone (a failed send, or it unmounted). A newer
 * veil's start is left alone; a start already handed to a scan is not here.
 */
export function clearSendLoaderStart(startedAt: number): void {
  if (sendLoaderStart === startedAt) sendLoaderStart = null;
}

/**
 * The scan was stored and its results page is about to open: hand it the
 * veil's start, when a veil is up. With none, any older handoff is dropped.
 */
export function noteLoaderHandoff(scanId: string): void {
  handoff =
    sendLoaderStart === null ? null : { scanId, startedAt: sendLoaderStart };
  sendLoaderStart = null;
}

/** The handed start for this scan, without clearing it; `null` with none. */
export function peekLoaderHandoff(scanId: string): number | null {
  return handoff !== null && handoff.scanId === scanId
    ? handoff.startedAt
    : null;
}

/**
 * Read the handed start for this scan once: it is cleared either way, so a
 * reload, a retry or another scan's page never finds it. `null` with none, or
 * when it was for another scan.
 */
export function takeLoaderHandoff(scanId: string): number | null {
  const at = peekLoaderHandoff(scanId);
  handoff = null;
  return at;
}

/**
 * The fit's reveal when the loader is on screen from the start (handed over
 * from the veil, started at `startedAt`): it is never hidden first, so even a
 * quick answer goes through it. A result fills the ring and fades (450 ms), a
 * failure stops it at once, with no minimum time (`MIN_DISPLAY_FIT_MS`), as
 * `fitReveal` does once its loader is up. Pure.
 */
export function handedFitReveal(
  startedAt: number,
  arrivedAt: number,
  ok: boolean,
): { loaderShownAt: number; revealAt: number } {
  const { doneAt } = loaderTimeline(
    startedAt,
    arrivedAt,
    LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    ok,
  );
  return { loaderShownAt: startedAt, revealAt: doneAt };
}

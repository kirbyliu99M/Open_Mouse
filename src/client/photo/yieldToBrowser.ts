/**
 * Lets the browser draw a frame between two steps of the photo analysis (F7,
 * Kirby's phone test 2026-10-21): the analysis runs on the main thread, so
 * without a break the loader's ring and particles froze for the whole run and
 * jumped to the end. Awaiting this between steps gives the page one frame:
 * the next animation frame (where the loader draws), then a task after it
 * (so that frame is painted before the next step starts).
 *
 * It changes nothing the analysis computes: it only waits. A page that is
 * hidden (no animation frames) or has none at all (tests, workers) waits for
 * one task instead, and a frame that never comes is given up on after
 * `YIELD_FALLBACK_MS`, so a run can never hang here.
 */

/** The longest wait for an animation frame before going on without one (ms). */
export const YIELD_FALLBACK_MS = 100;

export interface YieldEnvironment {
  readonly requestAnimationFrame?: (callback: () => void) => unknown;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  /** `document.visibilityState`, where there is a document. */
  readonly visibilityState?: string;
}

function browserEnvironment(): YieldEnvironment {
  const raf =
    typeof requestAnimationFrame === "function"
      ? (callback: () => void) => requestAnimationFrame(() => callback())
      : undefined;
  return {
    requestAnimationFrame: raf,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    visibilityState:
      typeof document !== "undefined" ? document.visibilityState : undefined,
  };
}

/** Resolves after the next painted frame (or one task, where frames do not come). */
export function yieldToBrowser(
  env: YieldEnvironment = browserEnvironment(),
): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (env.requestAnimationFrame && env.visibilityState !== "hidden") {
      env.requestAnimationFrame(() => env.setTimeout(finish, 0));
      env.setTimeout(finish, YIELD_FALLBACK_MS);
    } else {
      env.setTimeout(finish, 0);
    }
  });
}

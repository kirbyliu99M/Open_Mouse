import type { Page } from "@playwright/test";

/**
 * Stops the camera screen's detection loop at an exact moment, without a race.
 *
 * The loop runs on `requestAnimationFrame`. Polling for the moment ("the fourth
 * corner is found") and then stubbing the function afterwards leaves a gap, and
 * on a busy machine the gap is long enough for the auto-shutter to fire (it
 * needs a few good frames in a row) and replace the viewfinder under the test.
 *
 * Instead, before the page's own scripts run, `requestAnimationFrame` is
 * wrapped, and a `MutationObserver` watches the DOM for the wanted state. Its
 * callback runs as a microtask right after the mutation that made the state
 * true, before the browser can run another frame, and sets a flag. From then on
 * every frame callback that the app had queued is dropped and no new one is
 * accepted, so the loop stops where it is and cannot start again.
 *
 * Only for tests that measure a held state and do not click afterwards: it
 * stops every frame callback of the page, not just the camera's.
 */
export async function installLoopFreeze(
  page: Page,
  stopWhen: { selector: string; count: number },
): Promise<void> {
  await page.addInitScript(({ selector, count }) => {
    const w = window as Window & { __loopFrozen?: boolean };
    w.__loopFrozen = false;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback) =>
      w.__loopFrozen
        ? 0
        : raf((time) => {
            if (!w.__loopFrozen) callback(time);
          });
    const check = () => {
      if (
        !w.__loopFrozen &&
        document.querySelectorAll(selector).length >= count
      )
        w.__loopFrozen = true;
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    // It may already be true when the first mutation is seen.
    check();
  }, stopWhen);
}

/** Resolves once the loop has been stopped by `installLoopFreeze`. */
export function loopFrozen(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () => (window as Window & { __loopFrozen?: boolean }).__loopFrozen === true,
    undefined,
    // Timed, not on animation frames: those are what has just been stopped.
    { polling: 50, timeout: 30_000 },
  );
}

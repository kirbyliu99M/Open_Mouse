/**
 * How the home page's particle stage tries again after a failure to start: the
 * module's dynamic import (a dropped connection, or a chunk that an older page
 * asks for after a deploy) and the stage's own preparation (`prepare` in
 * src/components/home/particle-stage.ts). Pure.
 *
 * A bounded number of tries, each after a longer wait, and only while the tab
 * is shown (a hidden tab waits until it is shown again). After the last one the
 * page stays static, as it always did. Nothing loops: each try is one timer.
 */

/** The waits before the second and the third try, in ms. 未拍板 (candidate). */
export const START_RETRY_DELAYS_MS: readonly number[] = [1500, 4500];

/**
 * After `failures` failed tries (1 for the first), how long to wait before the
 * next one, or null when there is none left.
 */
export function retryDelay(
  failures: number,
  delays: readonly number[] = START_RETRY_DELAYS_MS,
): number | null {
  if (!Number.isInteger(failures) || failures < 1) return null;
  return delays[failures - 1] ?? null;
}

export type RetryStep = "run" | "wait-until-shown";

/** When a retry's wait is over: try now if the tab is shown, otherwise once it is. */
export function retryStep(hidden: boolean): RetryStep {
  return hidden ? "wait-until-shown" : "run";
}

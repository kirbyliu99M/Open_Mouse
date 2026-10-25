/**
 * V3.2 F13 (Kirby 2026-10-22, candidate / 未拍板): the veil over the last
 * question page while the scan is sent, with the particle loader on it,
 * instead of the button turning into 「傳送中…」. Pure (no React), so the
 * phases are tested without a browser; `SubmitOverlay.tsx` draws them.
 *
 * V3.2 F23 (Kirby's phone test 2026-10-25, candidate / 未拍板): one loader,
 * not two. The veil is now the page itself: the page colour at 100 %, there
 * at once (no fade in, with or without reduced motion), the question page
 * not seen through it, and the results page goes on with the same loader
 * (`src/lib/results/loaderHandoff.ts`).
 *
 *  - the send starts (`busy` true): the veil is `shown`, opaque, at once;
 *  - the scan was stored: it stays until the results page replaces the page;
 *  - the send failed (`busy` false again): `leaving` (it fades out), then
 *    `hidden`, and the page's error and retry are there underneath.
 */

/** Candidate values (模擬, chosen by Claude; Kirby's phone test decides). */
export const SUBMIT_OVERLAY = {
  /** The veil's opacity over the page: all of it (F23; F13 had 0.7). */
  VEIL_OPACITY: 1,
  /** Its fade out after a failed send; 0 under reduced motion (`overlayFadeMs`). It never fades in (F23). */
  FADE_MS: 220,
} as const;

export type OverlayPhase = "hidden" | "shown" | "leaving";

/** The phase once `busy` is what it now is. */
export function overlayPhaseFor(
  previous: OverlayPhase,
  busy: boolean,
): OverlayPhase {
  if (busy) return "shown";
  return previous === "shown" ? "leaving" : previous;
}

/** How long `leaving` lasts before the veil is gone. */
export function overlayFadeMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : SUBMIT_OVERLAY.FADE_MS;
}

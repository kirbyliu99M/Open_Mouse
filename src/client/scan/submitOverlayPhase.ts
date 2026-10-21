/**
 * V3.2 F13 (Kirby 2026-10-22, candidate / 未拍板): the veil that fades in over
 * the last question page while the scan is sent, with the particle loader on
 * it, instead of the button turning into 「傳送中…」. Pure (no React), so the
 * phases are tested without a browser; `SubmitOverlay.tsx` draws them.
 *
 *  - the send starts (`busy` true): the veil is `shown` (it fades in by CSS,
 *    or appears at once under reduced motion);
 *  - the scan was stored: it stays until the results page replaces the page;
 *  - the send failed (`busy` false again): `leaving` (it fades out), then
 *    `hidden`, and the page's error and retry are there underneath.
 */

/** Candidate values (模擬, chosen by Claude; Kirby's phone test decides). */
export const SUBMIT_OVERLAY = {
  /** The veil's opacity over the page. */
  VEIL_OPACITY: 0.7,
  /** Its fade in and out; 0 under reduced motion (`overlayFadeMs`). */
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

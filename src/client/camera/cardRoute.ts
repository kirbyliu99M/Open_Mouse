/**
 * v3.4 card mode (candidate 未拍板): when the card reference is in charge,
 * and when the person may change the reference. Pure, so the rules the
 * easy-scan camera follows are tested without a DOM.
 *
 * Kirby 2026-11-05: 「A4 & Card 是並存」 — the card path runs only where the
 * person measures against a card. A typed hand length (the "no paper" mode)
 * and a paper frame placed by hand both belong to the paper path, whatever
 * the reference chip says.
 */

export interface CardRouteInput {
  /** The reference chip is on the card (only ever true with the flag on). */
  readonly cardMode: boolean;
  /** A typed hand length, mm; `null` when the person measures with a reference. */
  readonly typedLengthMm: number | null;
  /** A paper frame placed by hand on this photo (the adjustment screen). */
  readonly manualPaperCorners?: unknown;
  /**
   * The photo came from the screen that shows the card mode (the live
   * camera: a shot, or an upload picked there). An upload from a screen that
   * does not show the reference (no camera, camera refused, the desktop
   * entry) takes the paper path (review m2). Default true (the live loop).
   */
  readonly referenceShown?: boolean;
}

/**
 * True when the card path (photo pipeline, live card loop, card overlay and
 * card-layout target) is in charge; false sends everything down the paper
 * path exactly as before the card existed.
 */
export function cardPathActive(input: CardRouteInput): boolean {
  return (
    input.cardMode &&
    input.referenceShown !== false &&
    input.typedLengthMm === null &&
    (input.manualPaperCorners === undefined ||
      input.manualPaperCorners === null)
  );
}

/**
 * Whether the reference (A4 / Letter / card) may change now. Not while a
 * shot is being taken or measured (測量中…): the photo would otherwise be
 * analysed in the other mode's pipeline (review item 13).
 */
export function referenceChangeAllowed(busy: {
  readonly capturing: boolean;
  readonly measuring: boolean;
}): boolean {
  return !busy.capturing && !busy.measuring;
}

/**
 * The card outline question is still unanswered (review F5): its dialog
 * closing now (not by 有 or 沒有) is treated as a retake.
 */
export function cardCheckUnanswered(result: {
  readonly kind: string;
  readonly cardCheck?: string;
}): boolean {
  return result.kind === "measured" && result.cardCheck === "pending";
}

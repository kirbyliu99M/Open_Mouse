/**
 * Closing a pop-up by a tap on the empty page around it (Kirby 2026-10-26,
 * candidate / 未拍板): "every popped out or glided out page can be cancelled
 * by clicking blank areas". Pure, so the rule is unit tested; the React side
 * is `useBlankTap` in src/components/dialog/useBlankTap.ts.
 *
 * A tap is blank when it lands on the overlay itself and not on the panel:
 *  - the overlay is the element the handlers are on (a modal `<dialog>`, whose
 *    `::backdrop` also reports the dialog as the target, or a backdrop div);
 *  - when the overlay IS the panel (a dialog drawn as the sheet itself), a tap
 *    on its own padding also reports it as the target, so the point must be
 *    outside its box;
 *  - an element marked `data-blank-tap` counts as empty too (the space around
 *    the share card on a phone, where the preview fills the screen).
 * Both the press and the release must be blank: a text selection or a drag
 * that starts in the panel and ends outside it does not close it.
 */
export const BLANK_TAP_ATTRIBUTE = "data-blank-tap";

export interface BlankTapTarget {
  /** The tap landed on the overlay element itself. */
  onOverlay: boolean;
  /** The tap landed on an element marked `data-blank-tap`. */
  onMarkedBlank: boolean;
  /** The overlay is also the panel (its own box is the visible sheet). */
  overlayIsPanel: boolean;
  /** The point is inside the overlay's box (only read when it is the panel). */
  insideOverlayBox: boolean;
}

export function isBlankTap(t: BlankTapTarget): boolean {
  if (t.onMarkedBlank) return true;
  if (!t.onOverlay) return false;
  return !t.overlayIsPanel || !t.insideOverlayBox;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function pointInBox(x: number, y: number, box: Box): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

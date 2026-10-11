/**
 * The decisions of the manual-entry sheet's drag, kept out of the component so
 * they can be tested without a browser. Candidate numbers (2026-10-12), to be
 * felt on a real phone; nothing here is calibrated.
 */

/** Movement under this is a tap, not a drag (px). */
export const TAP_SLOP_PX = 8;

/** Dragging the closed handle up by this much opens the sheet (px). */
export const OPEN_DRAG_PX = 36;
/** ...or by at least this much, fast enough (px, px per ms). */
export const OPEN_FLICK_MIN_PX = 16;
export const OPEN_FLICK_SPEED = 0.5;

/** Dragging the open sheet down by this share of its height closes it. */
export const CLOSE_DRAG_SHARE = 0.3;
/** ...or by at least this much, fast enough (px, px per ms). */
export const CLOSE_FLICK_MIN_PX = 24;
export const CLOSE_FLICK_SPEED = 0.6;

/** How far the handle follows the finger upward before it stops (px). */
export const HANDLE_FOLLOW_MAX_PX = 48;

/** A pointer moved more than a tap allows, in any direction. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > TAP_SLOP_PX;
}

/**
 * Whether letting go opens the sheet. `up` is how far the pointer travelled
 * upward since it went down (negative when it went down), `ms` how long it
 * was held.
 */
export function opensFromDrag(up: number, ms: number): boolean {
  if (up >= OPEN_DRAG_PX) return true;
  return up >= OPEN_FLICK_MIN_PX && up / Math.max(1, ms) >= OPEN_FLICK_SPEED;
}

/** Whether letting go closes the open sheet. `down` is the downward travel. */
export function closesFromDrag(
  down: number,
  ms: number,
  sheetHeight: number,
): boolean {
  if (down > sheetHeight * CLOSE_DRAG_SHARE) return true;
  return (
    down > CLOSE_FLICK_MIN_PX && down / Math.max(1, ms) >= CLOSE_FLICK_SPEED
  );
}

/** How far the closed handle shows itself moved while the finger is down. */
export function handleOffset(up: number): number {
  return -Math.min(HANDLE_FOLLOW_MAX_PX, Math.max(0, up));
}

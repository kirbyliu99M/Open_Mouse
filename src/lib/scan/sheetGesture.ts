/**
 * The decisions of the manual-entry sheet's drag, kept out of the component so
 * they can be tested without a browser. Candidate numbers (2026-10-12), to be
 * felt on a real phone; nothing here is calibrated.
 */

/**
 * Past this a press is tracked as a drag (px): the strip follows the finger.
 * It can still end as a tap (`isJitteryTap`).
 */
export const TAP_SLOP_PX = 8;

/**
 * A finger tap wobbles: a press that moved past `TAP_SLOP_PX` but never got
 * further than this from where it went down (px) still counts as a tap when it
 * ends (candidate).
 */
export const TAP_MAX_TRAVEL_PX = 24;

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
 * A press that ended as a jittery tap: over the whole press it never got
 * further than `TAP_MAX_TRAVEL_PX` from where it went down, and never more than
 * `TAP_SLOP_PX` below it. Sideways and upward wobble open the sheet; a drag
 * downward never does, even one that comes back before letting go. `farthest`
 * is the largest distance from the start seen during the press, `farthestDown`
 * the largest downward travel (0 if it only went up).
 */
export function isJitteryTap(farthest: number, farthestDown: number): boolean {
  return farthest <= TAP_MAX_TRAVEL_PX && farthestDown <= TAP_SLOP_PX;
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

/**
 * The click that follows a drag. A drag that moved the handle ends in a click
 * on the same element on a mouse, but not always on a touch screen, so the
 * flag that swallows that click must not outlive the gesture: it is cleared
 * when the next press starts and after `CLICK_GUARD_MS`, and a keyboard click
 * (`detail` 0: Enter or Space, never a pointer) is never swallowed.
 */
export const CLICK_GUARD_MS = 100;

export interface ClickGuard {
  /** A drag has just ended: the click that may follow it is not a tap. */
  armAfterDrag: () => void;
  /** A new press started, or the guard timed out. */
  reset: () => void;
  /** Whether this click is to be ignored; consumes the guard either way. */
  swallows: (detail: number) => boolean;
}

export function createClickGuard(): ClickGuard {
  let armed = false;
  return {
    armAfterDrag: () => {
      armed = true;
    },
    reset: () => {
      armed = false;
    },
    swallows: (detail) => {
      const swallow = armed && detail !== 0;
      armed = false;
      return swallow;
    },
  };
}

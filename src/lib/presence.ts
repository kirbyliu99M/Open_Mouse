/**
 * The pure rules behind "nothing pops in or out" (V3.2 motion pass, candidate /
 * 未拍板). A dialog, sheet or banner that is asked to go away first plays its
 * leaving animation and only then unmounts (or `close()`s); asked back while it
 * is still leaving, it simply stays. The React side is
 * `src/components/motion/Presence.tsx`; the timings are `leaveMs()` in
 * `src/lib/motion.ts`.
 */

/** Where something is in its life on screen. */
export type PresencePhase = "closed" | "open" | "leaving";

/**
 * What happened: the owner wants it shown or hidden, or the leaving animation
 * has had its time.
 */
export type PresenceEvent = "show" | "hide" | "done";

/**
 * The next phase. `show` always opens (also in the middle of leaving: it is
 * interrupted where it is, and runs back), `hide` starts leaving only from
 * open, and `done` ends only a leave: a late timer of an earlier leave does
 * nothing to something that was opened again.
 */
export function presenceStep(
  phase: PresencePhase,
  event: PresenceEvent,
): PresencePhase {
  switch (event) {
    case "show":
      return "open";
    case "hide":
      return phase === "open" ? "leaving" : phase;
    case "done":
      return phase === "leaving" ? "closed" : phase;
  }
}

/** The timer functions a leave uses (the window's, or a test's). */
export interface LeaveTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

/** One leave of something that closes itself (a native dialog, a sheet). */
export interface Leave {
  /**
   * Start leaving: `onLeaving(true)` now, `finish()` after `wait()` ms. A
   * second request while it is leaving does nothing (Esc pressed twice, a
   * click on the scrim during the slide). Returns whether this call started it.
   */
  request: () => boolean;
  /** Stop a leave in progress (the thing was asked back): `onLeaving(false)`. */
  cancel: () => void;
  /** The owner unmounts: no `finish()` after this. */
  dispose: () => void;
  readonly leaving: boolean;
}

/**
 * The leave of something that ends itself: it gets `data-leaving` (through
 * `onLeaving`), and `finish` (the real `close()`, the call that unmounts it)
 * runs once the animation has had `wait()` ms.
 */
export function createLeave({
  wait,
  finish,
  onLeaving,
  timers,
}: {
  /** How long the leaving animation runs (`leaveMs(kind, reducedMotion)`). */
  wait: () => number;
  finish: () => void;
  onLeaving?: (leaving: boolean) => void;
  timers: LeaveTimers;
}): Leave {
  let timer: unknown = null;
  let leaving = false;
  let disposed = false;
  const stop = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return {
    request() {
      if (leaving || disposed) return false;
      leaving = true;
      onLeaving?.(true);
      timer = timers.set(() => {
        timer = null;
        if (disposed) return;
        finish();
      }, wait());
      return true;
    },
    cancel() {
      if (!leaving || disposed) return;
      stop();
      leaving = false;
      onLeaving?.(false);
    },
    dispose() {
      disposed = true;
      stop();
    },
    get leaving() {
      return leaving;
    },
  };
}

/**
 * Which rows of a list fade in after a change (the all-mice page, #29): all of
 * them from the top when the filter changed, the new ones when 「顯示更多」
 * added a batch, none otherwise (a search keystroke, a re-render). The caller
 * staggers them with `rowDelayMs` (the first five only).
 */
export function enteringRowsFrom({
  previousKey,
  key,
  previousShown,
  shown,
}: {
  previousKey: string;
  key: string;
  previousShown: number;
  shown: number;
}): number | null {
  if (key !== previousKey) return 0;
  if (shown > previousShown) return previousShown;
  return null;
}

/**
 * The order of the results page's filter changes while the cards animate
 * (V3.2 motion pass #7, review fix; candidate / 未拍板).
 *
 * The shape toggle HOLDS its change while the old cards fade out (160 ms) and
 * applies it at the end. Any change that arrives meanwhile (another toggle, a
 * chip, the sidebar, the sheet) first FLUSHES the held one: it is applied at
 * once, so no change is ever dropped and every `filter_applied` fires, in the
 * order the person made them. A change computed from the filters on screen
 * (which do not have the held change yet) is then rebased onto it with the
 * held change's `rebase`.
 *
 * Pure: no timers, no DOM. `useSegmentSwap` drives it.
 */

export interface HeldChange<T> {
  /** Apply the change (computed from the latest value when it runs). */
  apply: () => void;
  /** The same change, put on top of a value computed without it. */
  rebase: (value: T) => T;
}

export interface ChangeGate<T> {
  /**
   * Apply the held change now, if there is one, and return how to put it
   * under a change computed without it (identity when nothing was held).
   */
  flush: () => (value: T) => T;
  /** Flush whatever is held, then hold this change. Returns its id. */
  hold: (change: HeldChange<T>) => number;
  /** Whether the change with this id is still the one held. */
  holds: (id: number) => boolean;
  /**
   * The fade-out of change `id` has ended: apply it, if it is still held
   * (a later change may have flushed it already). Returns whether it did.
   */
  release: (id: number) => boolean;
}

const identity = <T>(value: T): T => value;

export function createChangeGate<T>(): ChangeGate<T> {
  let held: { id: number; change: HeldChange<T> } | null = null;
  let seq = 0;
  const take = () => {
    const current = held;
    held = null;
    return current;
  };
  const flush = (): ((value: T) => T) => {
    const current = take();
    if (!current) return identity;
    current.change.apply();
    return current.change.rebase;
  };
  return {
    flush,
    hold(change) {
      flush();
      seq += 1;
      held = { id: seq, change };
      return seq;
    },
    holds(id) {
      return held !== null && held.id === id;
    },
    release(id) {
      if (held === null || held.id !== id) return false;
      take()!.change.apply();
      return true;
    },
  };
}

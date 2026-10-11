/**
 * The two pieces of the enlarged-photo dialog that are easy to get wrong and
 * are not about zoom, kept out of the React component so they can be tested
 * without a DOM (the repo has no jsdom): opening and closing the native modal
 * with the page lock, and deciding whether a press was a press on the scrim.
 * No imports; pure apart from the objects handed in.
 */

/** The part of `HTMLDialogElement` the lock uses. */
export interface DialogLike {
  open: boolean;
  showModal?: () => void;
  close: () => void;
}

/** The part of `document.body` the lock uses. */
export interface BodyLike {
  style: { overflow: string };
}

export interface ModalLock {
  /**
   * Whether a `close` event that has just arrived is a real close, to be
   * passed on. It is not when the dialog is open again (React StrictMode runs
   * an effect's cleanup and then its body a second time in development: the
   * cleanup's `close()` fires its event asynchronously, after the second
   * `showModal()`), nor after `dispose()`.
   */
  shouldNotifyClosed: () => boolean;
  /** Undo the lock: restore the page scroll, and close the dialog if open. */
  dispose: () => void;
}

/**
 * Show `dialog` as a modal and stop the page behind it from scrolling. The
 * scroll style is restored by `dispose()`, whether the dialog was closed by
 * the user or the component unmounted.
 */
export function lockModal(dialog: DialogLike, body: BodyLike): ModalLock {
  if (!dialog.open && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
  const previous = body.style.overflow;
  body.style.overflow = "hidden";
  let disposed = false;
  return {
    shouldNotifyClosed: () => !disposed && !dialog.open,
    dispose: () => {
      disposed = true;
      body.style.overflow = previous;
      if (dialog.open) dialog.close();
    },
  };
}

export interface ScrimPress {
  /** A pointer went down. `onScrim`: its target was the scrim itself. */
  down: (pointerId: number, onScrim: boolean) => void;
  /**
   * A pointer went up. True when this press, start to end, was one pointer
   * that began and ended on the scrim itself: the dialog may close.
   */
  up: (pointerId: number, onScrim: boolean) => boolean;
  /** A pointer was cancelled or lost: the press is void. */
  cancel: (pointerId: number) => void;
}

/**
 * A press on the scrim closes the dialog only when pointerdown and pointerup
 * both landed on the scrim and no second pointer joined in between. A second
 * finger landing on the scrim (a pinch that starts outside the photo) or a
 * drag that starts on the photo and ends on the scrim is not a close.
 */
export function createScrimPress(): ScrimPress {
  const active = new Set<number>();
  let armed = false;
  let spoiled = false;

  const settle = () => {
    if (active.size === 0) {
      armed = false;
      spoiled = false;
    }
  };

  return {
    down(pointerId, onScrim) {
      active.add(pointerId);
      if (active.size > 1) {
        spoiled = true;
        armed = false;
      } else {
        spoiled = false;
        armed = onScrim;
      }
    },
    up(pointerId, onScrim) {
      if (!active.has(pointerId)) return false;
      active.delete(pointerId);
      const close = armed && !spoiled && onScrim && active.size === 0;
      settle();
      return close;
    },
    cancel(pointerId) {
      active.delete(pointerId);
      armed = false;
      settle();
    },
  };
}

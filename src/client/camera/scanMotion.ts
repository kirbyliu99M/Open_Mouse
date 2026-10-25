import { MOTION } from "@/lib/motion";

/**
 * The scan flow's share of the V3.2 motion pass (Kirby 2026-10-26 "閃現",
 * candidate / 未拍板): the timings the script needs to keep something on
 * screen while its CSS animation runs. Every number comes from `MOTION`
 * (src/lib/motion.ts), which mirrors the `--motion-*` tokens; the CSS that
 * draws each fade names the same token.
 */

/** Which fade token a piece of the scan screen uses. */
export type ScanFade = "fast" | "base" | "out";

/**
 * How long a fade in the scan flow runs (ms), and so how long the element
 * leaving with it stays mounted. Under reduced motion every fade is the same
 * short `--motion-reduced` one.
 */
export function fadeMs(kind: ScanFade, reducedMotion: boolean): number {
  if (reducedMotion) return MOTION.REDUCED_MS;
  if (kind === "fast") return MOTION.FAST_MS;
  if (kind === "base") return MOTION.BASE_MS;
  return MOTION.OUT_MS;
}

export interface AnswerPageSwap {
  /** The old page fading out. */
  readonly outMs: number;
  /** The new page fading in. */
  readonly inMs: number;
  /** Where the old page goes (px, along x). */
  readonly outToPx: number;
  /** Where the new page comes from (px, along x). */
  readonly inFromPx: number;
}

/**
 * The change-over of the two question pages (V3.2 motion pass #4), the same
 * shape as the results page's shape toggle (`cardMotion`): the old page
 * fades out towards where the person is going (`--motion-out`, 24 px), the
 * new one comes in from the other side (`--motion-base`). Forward moves to
 * the left (the next page comes from the right), back to the right. Reduced
 * motion: a 120 ms fade each way, nothing moves.
 */
export function answerPageSwap(
  dir: -1 | 1,
  reducedMotion: boolean,
): AnswerPageSwap {
  if (reducedMotion)
    return {
      outMs: MOTION.REDUCED_MS,
      inMs: MOTION.REDUCED_MS,
      outToPx: 0,
      inFromPx: 0,
    };
  const shift = MOTION.SHIFT_PX * dir;
  return {
    outMs: MOTION.OUT_MS,
    inMs: MOTION.BASE_MS,
    outToPx: -shift,
    inFromPx: shift,
  };
}

/** The keyframes of a page swap: each a list of opacity and transform only. */
export interface PageSwapKeyframes {
  /** The old page: one keyframe, so it fades from where it is now. */
  readonly out: readonly Keyframe[];
  /** The new page: from the side it comes from to where it rests. */
  readonly in: readonly Keyframe[];
}

/** The Web Animations keyframes of `answerPageSwap` (opacity and transform). */
export function pageSwapKeyframes(m: AnswerPageSwap): PageSwapKeyframes {
  return {
    out: [{ opacity: 0, transform: `translateX(${m.outToPx}px)` }],
    in: [
      { opacity: 0, transform: `translateX(${m.inFromPx}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ],
  };
}

/**
 * What a page swap does once its old page has faded out (fix round, review
 * items 2 and 3):
 * - `superseded`: a later swap took over; it applies (or drops) the change.
 * - `apply`: nothing changed while the page faded: the change is made.
 * - `release`: the page was left by another way while it faded (返回 with Esc,
 *   or the scan started sending): the change is dropped and the old page is
 *   shown again, usable.
 * - `keep`: the same, but the dialog itself is leaving: the old page stays
 *   faded out, so it does not flash back inside the fading dialog.
 */
export type SwapSettle = "superseded" | "apply" | "release" | "keep";

export function settleSwap(o: {
  /** This swap's number, and the newest one's. */
  readonly mine: number;
  readonly latest: number;
  /** Whether the step and the sending state are still what they were when pressed. */
  readonly stillValid: boolean;
  /** Whether the dialog is leaving or gone. */
  readonly dialogLeaving: boolean;
}): SwapSettle {
  if (o.mine !== o.latest) return "superseded";
  if (o.stillValid && !o.dialogLeaving) return "apply";
  return o.dialogLeaving ? "keep" : "release";
}

/**
 * The state of something that leaves the screen (useLeaving.ts), kept apart
 * so its rules are tested without React (fix round, review item 4).
 * `wasPresent`: whether it was wanted at the last render; `leaving`: whether
 * its leave is running (the hook's timer ends it).
 */
export interface LeavingState {
  readonly wasPresent: boolean;
  readonly leaving: boolean;
}

/**
 * The state after a render where it is (or is not) wanted. Wanted → not: the
 * leave starts. Not → wanted, during a leave or not: the leave is dropped and
 * it is simply shown. No change: the same object (no re-render).
 */
export function leavingAfter(
  state: LeavingState,
  present: boolean,
): LeavingState {
  if (present === state.wasPresent) return state;
  return { wasPresent: present, leaving: !present };
}

/** The leave's time is up (the same object when nothing was leaving). */
export function leavingTimedOut(state: LeavingState): LeavingState {
  return state.leaving
    ? { wasPresent: state.wasPresent, leaving: false }
    : state;
}

/**
 * What to render: the value while there is one; during a leave the last one
 * shown, marked leaving; else nothing.
 */
export function leavingView<T>(
  value: T | null,
  state: LeavingState,
  last: T | null,
): { shown: T | null; leaving: boolean } {
  if (value !== null) return { shown: value, leaving: false };
  const leaving = state.leaving && last !== null;
  return { shown: leaving ? last : null, leaving };
}

/** Where a leaving piece was when its leave began (LeaveShield.tsx). */
export interface ShieldBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Its computed z-index ("auto" or a number as text). */
  readonly zIndex: string;
}

/**
 * The tap-absorbing layer's box (e2e round 2): the piece's own box, one
 * z-index above it, so what comes back under the piece never gets a tap that
 * landed on it. `null` for a piece with no box (nothing to cover).
 */
export function leaveShieldStyle(box: ShieldBox): {
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
} | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const z = Number.parseInt(box.zIndex, 10);
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    zIndex: (Number.isFinite(z) ? z : 0) + 1,
  };
}

/** The little of the DOM `closeAsIfRemoved` needs (a test passes fakes). */
interface FocusableLike {
  focus(options?: FocusOptions): void;
  blur(): void;
  readonly isConnected?: boolean;
}
interface DialogLike {
  readonly open: boolean;
  close(): void;
  contains(node: unknown): boolean;
}
interface DocumentLike {
  readonly activeElement: unknown;
  readonly body: unknown;
}

function focusable(node: unknown): node is FocusableLike {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as FocusableLike).focus === "function" &&
    typeof (node as FocusableLike).blur === "function"
  );
}

/**
 * Closes a modal `<dialog>` that is about to fade or slide away, with the
 * focus outcome its removal from the page had before the motion pass.
 *
 * The dialogs of the scan flow used to be unmounted the moment they were no
 * longer wanted; now they stay painted while they leave (`data-leaving`,
 * inert, closed so the screen under them is usable at once). `close()` on a
 * modal dialog would also move focus back to whatever had it before the
 * dialog opened, which an unmount never did. So:
 * - focus inside the dialog (it was what the person used) ends on <body>, as
 *   an unmount left it;
 * - focus already elsewhere (the next screen took it in the same commit)
 *   stays there.
 */
export function closeAsIfRemoved(
  dialog: DialogLike | null,
  doc: DocumentLike = document,
): void {
  if (!dialog?.open) return;
  const before = doc.activeElement;
  const inside =
    before !== null && before !== doc.body && dialog.contains(before);
  dialog.close();
  const after = doc.activeElement;
  if (after === before) {
    if (inside && focusable(after)) after.blur();
    return;
  }
  if (
    !inside &&
    before !== doc.body &&
    focusable(before) &&
    before.isConnected !== false
  ) {
    before.focus({ preventScroll: true });
    return;
  }
  if (focusable(after) && after !== doc.body) after.blur();
}

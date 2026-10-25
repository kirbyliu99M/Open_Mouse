import { MOTION } from "@/lib/motion";
import type { AnswerStep } from "../scan/answers";

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

/** A question page that is on screen (the sheet is not a page). */
export type AnswerPage = Exclude<AnswerStep, "sheet">;

/**
 * Which way a change of question page goes (V3.2 motion pass #4): 1 on the
 * way forward (grip → thickness), -1 on the way back, 0 when the page does
 * not change or the change is not between two pages (the dialog itself fades
 * in or out then).
 */
export function answerPageDirection(
  from: AnswerStep,
  to: AnswerStep,
): -1 | 0 | 1 {
  if (from === "grip" && to === "thickness") return 1;
  if (from === "thickness" && to === "grip") return -1;
  return 0;
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

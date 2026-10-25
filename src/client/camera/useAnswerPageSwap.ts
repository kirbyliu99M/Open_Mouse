"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION } from "@/lib/motion";
import { answerPageSwap, pageSwapKeyframes, settleSwap } from "./scanMotion";

const PAGE = ".answerPage";

/** The question page in the dialog, or none where the browser cannot animate. */
function pageIn(root: HTMLElement | null): HTMLElement | null {
  const page = root?.querySelector<HTMLElement>(PAGE) ?? null;
  return page && typeof page.animate === "function" ? page : null;
}

/** What a swap holds until it is settled: the fade-outs and the pages made inert. */
interface Held {
  animations: Animation[];
  pages: HTMLElement[];
}

/** Ends the fade-outs that still hold the old page, and makes it usable again. */
function release(held: { current: Held }) {
  for (const a of held.current.animations) a.cancel();
  for (const page of held.current.pages) page.inert = false;
  held.current = { animations: [], pages: [] };
}

/** Whether the dialog is fading out or gone (useLeaving's `data-leaving`). */
function dialogLeaving(root: HTMLElement | null): boolean {
  return !root || !root.isConnected || root.dataset.leaving === "true";
}

/**
 * The change-over between the grip and thickness pages (V3.2 motion pass #4,
 * candidate / 未拍板), the scan flow's copy of the results page's
 * `useSegmentSwap`: `swap(dir, apply, stillValid)` fades the page out towards
 * where the person is going (`--motion-out`, `--motion-shift`), then applies
 * the change, and the layout effect brings the new page in from the other side
 * (`--motion-base`). Forward (1) goes left, back (-1) goes right. Only
 * transform and opacity move (`pageSwapKeyframes`), through the Web
 * Animations API, so nothing is left on the page after. Reduced motion: a
 * 120 ms fade each way.
 *
 * The old page is inert while it fades (fix round, review item 2): a press
 * already made is the one that counts, so 送出 or 跳過 cannot start a send
 * that the delayed change would then hide. When the fade is over, the change
 * is made only if `stillValid()` (the step and the sending state are what
 * they were) and the dialog is not leaving (`settleSwap`). Otherwise it is
 * dropped: the old page is shown again, or, inside a dialog that is fading
 * out, kept faded so it does not flash (review item 3). A second swap wins.
 * Where there is no page or no `Element.animate`, the change is applied at
 * once.
 */
export function useAnswerPageSwap(
  rootRef: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
) {
  const token = useRef(0);
  const pendingIn = useRef<-1 | 1 | null>(null);
  const held = useRef<Held>({ animations: [], pages: [] });
  // A swap whose old page is still fading (not settled yet).
  const inFlight = useRef(false);

  const swap = useCallback(
    (
      dir: -1 | 1,
      apply: () => void,
      stillValid: () => boolean = () => true,
    ) => {
      const n = ++token.current;
      const page = pageIn(rootRef.current);
      if (!page) {
        release(held);
        apply();
        return;
      }
      const m = answerPageSwap(dir, reducedMotion);
      const frames = pageSwapKeyframes(m);
      // One keyframe: the fade starts from where the page is now, so a second
      // press during a fade does not flash the page back.
      const out = page.animate([...frames.out], {
        duration: m.outMs,
        easing: MOTION.EASE_IN,
        fill: "forwards",
      });
      held.current.animations.push(out);
      page.inert = true;
      held.current.pages.push(page);
      inFlight.current = true;
      out.finished
        .catch(() => undefined)
        .then(() => {
          const settle = settleSwap({
            mine: n,
            latest: token.current,
            stillValid: stillValid(),
            dialogLeaving: dialogLeaving(rootRef.current),
          });
          if (settle === "superseded") return;
          inFlight.current = false;
          if (settle === "keep") return;
          if (settle === "release") {
            release(held);
            return;
          }
          pendingIn.current = dir;
          apply();
          // A change that rendered no new page (the reducer refused it) must
          // not leave the page faded out: two frames later, show it again.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (n !== token.current || pendingIn.current === null) return;
              pendingIn.current = null;
              release(held);
            }),
          );
        });
    },
    [rootRef, reducedMotion],
  );

  // After the new page has rendered and before it is painted: it comes in.
  // Runs after every render and does nothing unless a swap is due.
  useLayoutEffect(() => {
    const dir = pendingIn.current;
    if (dir === null) {
      // A page kept faded inside a dialog that was leaving ("keep"), and the
      // dialog is wanted again before it went: show the page, usable.
      if (
        !inFlight.current &&
        held.current.pages.length > 0 &&
        !dialogLeaving(rootRef.current)
      )
        release(held);
      return;
    }
    pendingIn.current = null;
    release(held);
    const page = pageIn(rootRef.current);
    if (!page) return;
    const m = answerPageSwap(dir, reducedMotion);
    page.animate([...pageSwapKeyframes(m).in], {
      duration: m.inMs,
      easing: MOTION.EASE_OUT,
    });
  });

  return swap;
}

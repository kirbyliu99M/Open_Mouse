"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION } from "@/lib/motion";
import { answerPageSwap } from "./scanMotion";

const PAGE = ".answerPage";

/** The question page in the dialog, or none where the browser cannot animate. */
function pageIn(root: HTMLElement | null): HTMLElement | null {
  const page = root?.querySelector<HTMLElement>(PAGE) ?? null;
  return page && typeof page.animate === "function" ? page : null;
}

/** Ends the fade-outs that still hold the old page. */
function release(held: { current: Animation[] }) {
  for (const a of held.current) a.cancel();
  held.current = [];
}

/**
 * The change-over between the grip and thickness pages (V3.2 motion pass #4,
 * candidate / 未拍板), the scan flow's copy of the results page's
 * `useSegmentSwap`: `swap(dir, apply)` fades the page out towards where the
 * person is going (`--motion-out`, `--motion-shift`), then applies the change,
 * and the layout effect brings the new page in from the other side
 * (`--motion-base`). Forward (1) goes left, back (-1) goes right. Only
 * transform and opacity move, through the Web Animations API, so nothing is
 * left on the page after. Reduced motion: a 120 ms fade each way.
 *
 * Nothing is blocked while the old page fades: a second press wins (only the
 * last change is applied). Where there is no page or no `Element.animate`,
 * the change is applied at once.
 */
export function useAnswerPageSwap(
  rootRef: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
) {
  const token = useRef(0);
  const pendingIn = useRef<-1 | 1 | null>(null);
  const held = useRef<Animation[]>([]);

  const swap = useCallback(
    (dir: -1 | 1, apply: () => void) => {
      const n = ++token.current;
      const page = pageIn(rootRef.current);
      if (!page) {
        release(held);
        apply();
        return;
      }
      const m = answerPageSwap(dir, reducedMotion);
      // One keyframe: the fade starts from where the page is now, so a second
      // press during a fade does not flash the page back.
      const out = page.animate(
        [{ opacity: 0, transform: `translateX(${m.outToPx}px)` }],
        { duration: m.outMs, easing: MOTION.EASE_IN, fill: "forwards" },
      );
      held.current.push(out);
      out.finished
        .catch(() => undefined)
        .then(() => {
          if (n !== token.current) return;
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
    if (dir === null) return;
    pendingIn.current = null;
    release(held);
    const page = pageIn(rootRef.current);
    if (!page) return;
    const m = answerPageSwap(dir, reducedMotion);
    page.animate(
      [
        { opacity: 0, transform: `translateX(${m.inFromPx}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: m.inMs, easing: MOTION.EASE_OUT },
    );
  });

  return swap;
}

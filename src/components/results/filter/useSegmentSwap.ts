"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import {
  cardMotion,
  rowDelayMs,
  TOGGLE_MOTION,
} from "@/lib/results/shapeToggle";

/**
 * The large card's parts (everything in the hero but the hand type above it,
 * which a switch does not change) and the rows of the other picks.
 */
const CARD = ".results-hero > :not(.results-hand)";
const ROWS = ".results-others-grid > li";

/** The large card's parts, or none where the browser cannot animate. */
function cardParts(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const parts = [...root.querySelectorAll<HTMLElement>(CARD)];
  return parts.length > 0 && typeof parts[0]!.animate === "function"
    ? parts
    : [];
}

/** Ends the fade-outs that still hold their elements. */
function release(held: { current: Animation[] }) {
  for (const a of held.current) a.cancel();
  held.current = [];
}

/**
 * The shape toggle's change-over of the cards (V3.2 U1, candidate). `swap`
 * fades the large card out towards the side the person moved to (160 ms,
 * 24 px), then applies the change, and the layout effect brings the new card
 * in from the other side (220 ms) and the rows of the other picks one after
 * another (30 ms apart, the first five). Only transform and opacity move,
 * through the Web Animations API, so nothing is left on the elements after.
 * With reduced motion every part is a 120 ms fade with no movement.
 *
 * The hand type above the card stays where it is: a switch does not change it.
 *
 * Where there is nothing to animate (no large card, or a browser without
 * `Element.animate`), the change is applied at once. A second press while the
 * first is still fading out wins: only the last change is applied.
 */
export function useSegmentSwap(
  rootRef: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
) {
  const token = useRef(0);
  const pendingIn = useRef<{ dir: -1 | 0 | 1 } | null>(null);
  // Animations still holding an element (the fade-outs, which keep their end).
  const held = useRef<Animation[]>([]);

  const swap = useCallback(
    (dir: -1 | 0 | 1, apply: () => void) => {
      const n = ++token.current;
      const root = rootRef.current;
      const parts = cardParts(root);
      if (!root || parts.length === 0) {
        release(held);
        apply();
        return;
      }
      const m = cardMotion(dir, reducedMotion);
      // One keyframe: each fade starts from where the element is now, so a
      // second press during a fade-out does not flash the card back.
      const outs = parts.map((part) =>
        part.animate(
          [{ opacity: 0, transform: `translateX(${m.outToPx}px)` }],
          { duration: m.outMs, easing: "ease-in", fill: "forwards" },
        ),
      );
      held.current.push(...outs);
      root.querySelectorAll<HTMLElement>(ROWS).forEach((row) => {
        held.current.push(
          row.animate([{ opacity: 0 }], {
            duration: m.outMs,
            easing: "ease-in",
            fill: "forwards",
          }),
        );
      });
      Promise.all(outs.map((a) => a.finished))
        .catch(() => undefined)
        .then(() => {
          if (n !== token.current) return;
          pendingIn.current = { dir };
          apply();
          // A change that rendered nothing new must not leave the cards
          // faded out: two frames later, show them as they are.
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

  // After the change has rendered and before it is painted: the new cards
  // come in. Runs after every render, and does nothing unless a swap is due.
  useLayoutEffect(() => {
    const due = pendingIn.current;
    if (!due) return;
    pendingIn.current = null;
    release(held);
    const root = rootRef.current;
    const parts = cardParts(root);
    if (!root || parts.length === 0) return;
    const m = cardMotion(due.dir, reducedMotion);
    for (const part of parts) {
      part.animate(
        [
          { opacity: 0, transform: `translateX(${m.inFromPx}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: m.inMs, easing: TOGGLE_MOTION.EASE_OUT },
      );
    }
    root.querySelectorAll<HTMLElement>(ROWS).forEach((row, i) => {
      const delay = rowDelayMs(i, reducedMotion);
      if (delay === null) return;
      row.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: m.inMs,
        delay,
        easing: TOGGLE_MOTION.EASE_OUT,
        // Hidden until its turn.
        fill: "backwards",
      });
    });
  });

  return swap;
}

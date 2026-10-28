"use client";

import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";
import { BLANK_TAP_ATTRIBUTE, isBlankTap, pointInBox } from "@/lib/blankTap";

/**
 * Handlers that close a pop-up on a tap on the empty page around it (the
 * rule is `isBlankTap` in src/lib/blankTap.ts). Spread them on the overlay:
 * the modal `<dialog>`, or the backdrop element that holds the panel.
 * `panel: "self"` when the overlay is drawn as the panel itself (a side
 * menu, a bottom sheet, a centred card); `"child"` when the panel is inside
 * a full-screen overlay. `enabled: false` while the pop-up must not close
 * (sending, deleting).
 */
export function useBlankTap(
  onDismiss: () => void,
  { panel, enabled = true }: { panel: "self" | "child"; enabled?: boolean },
): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
} {
  const pressedBlank = useRef(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const blank = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target;
      const overlay = event.currentTarget;
      const onOverlay = target === overlay;
      return isBlankTap({
        onOverlay,
        onMarkedBlank:
          target instanceof Element && target.hasAttribute(BLANK_TAP_ATTRIBUTE),
        overlayIsPanel: panel === "self",
        insideOverlayBox:
          onOverlay &&
          pointInBox(
            event.clientX,
            event.clientY,
            overlay.getBoundingClientRect(),
          ),
      });
    },
    [panel],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      pressedBlank.current = blank(event);
    },
    [blank],
  );
  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const pressed = pressedBlank.current;
      pressedBlank.current = false;
      if (!enabled || !pressed || !blank(event)) return;
      dismissRef.current();
    },
    [blank, enabled],
  );
  return { onPointerDown, onClick };
}

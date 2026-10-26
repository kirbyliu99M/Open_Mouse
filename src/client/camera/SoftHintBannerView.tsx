"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

/**
 * The post-shot soft hint (V3.3 WP3b, candidate 未拍板; softHintBanner.ts):
 * one glass line over the photo, just above the measured sheet, with a close
 * button (44 px target). It never covers the sheet's buttons and blocks
 * nothing.
 *
 * It is rendered INSIDE the sheet's modal <dialog>, because everything
 * outside a modal dialog is inert (the close button must work). Inside, the
 * dialog's overflow and containment would clip it, so where the browser has
 * the Popover API it is shown as a manual popover: the top layer, placed by
 * the viewport (`bottom` = the sheet's height plus a gap, kept up to date as
 * the sheet grows). Without the Popover API it stays where it is, at the top
 * of the sheet.
 */
export function SoftHintBanner({
  text,
  dismissLabel,
  onDismiss,
  leaving,
  sheetRef,
}: {
  readonly text: string;
  readonly dismissLabel: string;
  readonly onDismiss: () => void;
  readonly leaving: boolean;
  /** The sheet it sits above (its height places the banner). */
  readonly sheetRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bottomPx, setBottomPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      // Not supported in this context: it stays at the top of the sheet.
    }
    return () => {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        // Already gone.
      }
    };
  }, []);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const measure = () => setBottomPx(sheet.offsetHeight);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [sheetRef]);

  return (
    <div
      ref={ref}
      popover="manual"
      className="easySoftHint"
      role="status"
      data-testid="easy-soft-hint"
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      style={
        bottomPx !== null
          ? ({ "--soft-hint-sheet": `${bottomPx}px` } as CSSProperties)
          : undefined
      }
    >
      <p className="easySoftHintText">{text}</p>
      <button
        type="button"
        className="easySoftHintClose"
        aria-label={dismissLabel}
        data-testid="easy-soft-hint-close"
        onClick={onDismiss}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

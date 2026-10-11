"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
} from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { manualEntryCopy } from "@/lib/copy/manualEntry";
import {
  CLICK_GUARD_MS,
  closesFromDrag,
  createClickGuard,
  handleOffset,
  isDrag,
  opensFromDrag,
} from "@/lib/scan/sheetGesture";
import type { ManualEntryDraft } from "@/lib/scan/manualEntry";
import { ManualEntryForm, type ManualEntryValues } from "./ManualEntryForm";
import "./manual-entry.css";

export type { ManualEntryValues } from "./ManualEntryForm";

/** How long the slide-down takes; also the longest the close waits for it. */
const CLOSE_MS = 240;
/** The fade that replaces the slide with reduced motion (matches the CSS). */
const CLOSE_REDUCED_MS = 130;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// ── The handle ──────────────────────────────────────────────────────────────

/**
 * The entry to typing instead of scanning (candidate, 2026-10-12): a strip at
 * the bottom of the scan screen, 「改用輸入數字 ⌃」, that opens the sheet on a
 * tap, on Enter or Space, or on a drag upward (Pointer Events, so a finger, a
 * pen and a mouse all work). The drag is only a shortcut: a tap or the keyboard
 * always does the same (the visible text is the button's whole accessible
 * name, and nothing about dragging is announced: the button works without it),
 * and `touch-action: none` keeps the page from scrolling
 * under the finger. The strip follows the finger up to a short limit and eases
 * back when it is let go without opening (transform only; with reduced motion
 * it does not follow at all).
 *
 * Give it `ref` so the parent can put focus back on it when the sheet closes
 * (`returnFocusTo` of `ManualEntrySheet`).
 */
export function ManualEntryHandle({
  onOpen,
  ref,
  className,
}: {
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const locale = useLocale();
  const copy = manualEntryCopy(locale);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const press = useRef<{
    id: number;
    startX: number;
    startY: number;
    startT: number;
    moved: boolean;
  } | null>(null);
  // A drag that moved the strip may end in a click on the same element: that
  // click must not open the sheet a second time, or open it after a drag down.
  // The guard never outlives the gesture (see `createClickGuard`).
  const clickGuard = useRef(createClickGuard()).current;
  const guardTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(guardTimer.current), []);

  const setButton = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as RefObject<HTMLButtonElement | null>).current = node;
    },
    [ref],
  );

  const rest = () => {
    const node = buttonRef.current;
    if (!node) return;
    node.style.transition = "";
    node.style.transform = "";
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A new press: whatever an earlier drag left behind is gone.
    window.clearTimeout(guardTimer.current);
    clickGuard.reset();
    press.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startT: e.timeStamp,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (or synthetic): the drag still works on
      // the events this element receives.
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && isDrag(e.clientX - p.startX, e.clientY - p.startY))
      p.moved = true;
    if (p.moved && !prefersReducedMotion()) {
      const node = e.currentTarget;
      node.style.transition = "none";
      node.style.transform = `translateY(${handleOffset(p.startY - e.clientY)}px)`;
    }
  };

  const onPointerEnd = (
    e: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved) {
      clickGuard.armAfterDrag();
      // A touch drag may end with no click at all: do not wait for one.
      window.clearTimeout(guardTimer.current);
      guardTimer.current = window.setTimeout(clickGuard.reset, CLICK_GUARD_MS);
    }
    rest();
    if (
      !cancelled &&
      p.moved &&
      opensFromDrag(p.startY - e.clientY, e.timeStamp - p.startT)
    ) {
      onOpen();
    }
  };

  return (
    <button
      ref={setButton}
      type="button"
      className={`manualEntry-handle${className ? ` ${className}` : ""}`}
      aria-haspopup="dialog"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, false)}
      onPointerCancel={(e) => onPointerEnd(e, true)}
      onClick={(e) => {
        if (clickGuard.swallows(e.detail)) return;
        onOpen();
      }}
    >
      <span className="manualEntry-handleBar" aria-hidden="true" />
      <span className="manualEntry-handleLabel">
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x="2"
            y="5"
            width="16"
            height="10"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M5 8.5h1M8 8.5h1M11 8.5h1M14 8.5h1M6.5 11.5h7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span>{copy.handleLabel}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M3.5 10l4.5-4.5L12.5 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

// ── The sheet and the panel ─────────────────────────────────────────────────

/** What both presentations take besides their own props. */
type ManualEntryShared = {
  onUse: (values: ManualEntryValues) => void;
  /**
   * Where the form starts: a hand the person already stated on the scan
   * screen (there is no default hand), or everything they had typed before the
   * sheet closed. Only read when the form mounts.
   */
  initialDraft?: ManualEntryDraft;
  /** Told the whole draft after every change, so the parent can keep it. */
  onDraftChange?: (draft: ManualEntryDraft) => void;
};

type SheetProps = {
  presentation: "sheet";
  /** Cancel, Esc, the close button, a tap on the dimmed page and dragging the sheet down all end here. The parent unmounts the sheet. */
  onCancel: () => void;
  /** Where focus goes when the sheet closes: the handle that opened it. */
  returnFocusTo?: RefObject<HTMLElement | null>;
};
type PanelProps = {
  presentation: "panel";
  /** The panel has no cancel button unless this is given. */
  onCancel?: () => void;
  returnFocusTo?: undefined;
};

/**
 * Typing the hand length and width (candidate, 2026-10-12). Two presentations
 * of one form:
 *
 *  - `"sheet"` (phones): a bottom sheet over the dimmed scan screen, a native
 *    modal `<dialog>` (`showModal()`, so focus stays inside, the page behind is
 *    inert and Esc works), the same family as the results filter's sheet. MOUNT
 *    it to open it and unmount it from `onCancel`/`onUse`. Focus goes to the
 *    title on open and to `returnFocusTo` on close; the page does not scroll
 *    while it is open; dragging the top strip down closes it, and the close
 *    button is the visible alternative. With reduced motion it fades instead of
 *    sliding.
 *  - `"panel"` (desktop): the form inline, no dialog, no motion.
 *
 * `onUse` hands over `{ hand, handLengthMm, handWidthMm }`, whole millimetres,
 * valid by `checkManualEntry` and a chosen hand. It does not close the sheet:
 * the parent decides what comes next (the grip step). Build the payload with
 * `buildManualEntrySubmission` once the grip is known.
 */
export function ManualEntrySheet(
  props: (SheetProps | PanelProps) & ManualEntryShared,
) {
  return props.presentation === "sheet" ? (
    <SheetShell {...props} />
  ) : (
    <PanelShell {...props} />
  );
}

function PanelShell({
  onUse,
  onCancel,
  initialDraft,
  onDraftChange,
}: PanelProps & ManualEntryShared) {
  const locale = useLocale();
  const titleId = useId();
  return (
    <section
      className="manualEntry-panel"
      aria-labelledby={titleId}
      data-testid="manual-entry-panel"
    >
      <ManualEntryForm
        locale={locale}
        initialDraft={initialDraft}
        onDraftChange={onDraftChange}
        onUse={onUse}
        onCancel={onCancel}
        titleId={titleId}
      />
    </section>
  );
}

function SheetShell({
  onUse,
  onCancel,
  returnFocusTo,
  initialDraft,
  onDraftChange,
}: SheetProps & ManualEntryShared) {
  const locale = useLocale();
  const copy = manualEntryCopy(locale);
  const titleId = useId();
  const introId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closing = useRef(false);
  // The close animation's timer, and whether the sheet is still mounted: a
  // parent that unmounts the sheet inside the animation (`onUse`) must not get
  // a late `onCancel` or have focus pulled to the handle afterwards.
  const closeTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  // Where a press started: only a press that began AND ended on the dimmed
  // area closes, so selecting text in a field and letting go over it does not.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      mounted.current = false;
      window.clearTimeout(closeTimer.current);
      root.style.overflow = before;
    };
  }, []);

  const finish = useCallback(() => {
    if (!mounted.current) return;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    // Put focus back before the parent unmounts the sheet.
    returnFocusTo?.current?.focus({ preventScroll: true });
    onCancel();
  }, [onCancel, returnFocusTo]);

  /** Close with the slide-down (a short fade with reduced motion). */
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    dialogRef.current?.setAttribute("data-leaving", "true");
    closeTimer.current = window.setTimeout(
      finish,
      prefersReducedMotion() ? CLOSE_REDUCED_MS : CLOSE_MS,
    );
  }, [finish]);

  // ---- Dragging the top strip down
  const drag = useRef<{
    startY: number;
    startT: number;
    dy: number;
    id: number;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const sheet = dialogRef.current;
    if (!sheet || closing.current) return;
    drag.current = {
      startY: e.clientY,
      startT: e.timeStamp,
      dy: 0,
      id: e.pointerId,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone: the drag still follows this element.
    }
    // The opening animation would override the dragged transform: stop it.
    sheet.style.animation = "none";
    sheet.style.transition = "none";
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const sheet = dialogRef.current;
    if (!d || !sheet || d.id !== e.pointerId) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    sheet.style.transform = `translateY(${d.dy}px)`;
  };
  const endDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    const d = drag.current;
    const sheet = dialogRef.current;
    if (!d || !sheet || d.id !== e.pointerId) return;
    drag.current = null;
    const height = sheet.getBoundingClientRect().height;
    const leave =
      !cancelled && closesFromDrag(d.dy, e.timeStamp - d.startT, height);
    sheet.style.transition = "";
    if (leave) {
      // Carry on down from where the finger let go (a fade, with reduced motion).
      sheet.style.transform = prefersReducedMotion() ? "" : "translateY(100%)";
      requestClose();
    } else {
      // Back up from where the finger let go; it can be grabbed again at once.
      sheet.style.transform = "";
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="manualEntry-sheet"
      aria-labelledby={titleId}
      aria-describedby={introId}
      data-testid="manual-entry-sheet"
      onCancel={(e) => {
        // Esc: slide down, rather than the browser's instant close.
        e.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // Closed some other way (not through requestClose): still tell the parent.
        if (!closing.current) {
          closing.current = true;
          returnFocusTo?.current?.focus({ preventScroll: true });
          onCancel();
        }
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // A tap on the dimmed area (the dialog itself, outside its box) closes,
        // when the press began there too.
        const began = pressedBackdrop.current;
        pressedBackdrop.current = false;
        if (e.target === e.currentTarget && began) requestClose();
      }}
    >
      <div className="manualEntry-sheetPanel">
        <div
          className="manualEntry-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
        >
          <span className="manualEntry-grabBar" aria-hidden="true" />
          <button
            type="button"
            className="manualEntry-close"
            aria-label={copy.closeSheet}
            onClick={requestClose}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3.5 3.5l9 9M12.5 3.5l-9 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="manualEntry-sheetBody">
          <ManualEntryForm
            locale={locale}
            initialDraft={initialDraft}
            onDraftChange={onDraftChange}
            onUse={onUse}
            onCancel={requestClose}
            titleId={titleId}
            titleRef={titleRef}
            introId={introId}
          />
        </div>
      </div>
    </dialog>
  );
}

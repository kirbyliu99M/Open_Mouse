"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type RefObject,
} from "react";

/**
 * Remembers the last button or link that was clicked inside an element, so a
 * sheet opened by it can give focus back when it closes. `document.activeElement`
 * is not enough: Safari does not focus a button on click, so there it would be
 * the page body. Attach `onClickCapture` to an element whose subtree holds the
 * triggers and NOT the sheets they open (render those as siblings), otherwise a
 * click inside the sheet would replace the trigger.
 */
export function useLastTrigger(): {
  last: RefObject<HTMLElement | null>;
  onClickCapture: (event: MouseEvent) => void;
} {
  const last = useRef<HTMLElement | null>(null);
  const onClickCapture = useCallback((event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest("button, a[href]");
    if (el instanceof HTMLElement) last.current = el;
  }, []);
  return { last, onClickCapture };
}

/** Give focus to `target` when it is still in the page. Returns whether it did. */
export function focusIfConnected(
  target: HTMLElement | null | undefined,
): boolean {
  if (!target || !target.isConnected) return false;
  target.focus();
  return document.activeElement === target;
}

/**
 * Opens a native `<dialog>` as a modal when it mounts and closes it when it
 * unmounts, and gives focus back to `returnFocusTo()` (else whatever had focus
 * when it opened) if that control is still in the page.
 *
 * The dialog's `close` event arrives AFTER `dialog.close()`, even when it is
 * our own unmount that closed it (a sheet that is replaced by the next step,
 * or React's strict-mode second run in development). Handing that event to
 * `onClose` would close whatever opened next, so:
 *   - `onCancel` (Esc) always asks to close, and stops the browser's own
 *     instant close: the owner unmounts it, through `<Presence>`, after its
 *     way out (V3.2 motion pass), the same path as the Cancel button;
 *   - `onClose` asks to close only when the dialog really is closed now and
 *     this component is not the one being unmounted.
 */
export function useModalDialog({
  onClose,
  initialFocus,
  returnFocusTo,
}: {
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocusTo?: () => HTMLElement | null;
}): {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onCancel: (event?: { preventDefault: () => void }) => void;
  onClose: () => void;
} {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const unmounting = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocusTo);
  returnRef.current = returnFocusTo;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    unmounting.current = false;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      unmounting.current = true;
      dialog.close();
      const target = returnRef.current?.() ?? opener;
      if (target && target.isConnected && target !== document.body) {
        target.focus();
      }
    };
  }, [initialFocus]);

  const handleCancel = useCallback((event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (!unmounting.current) closeRef.current();
  }, []);
  const handleClose = useCallback(() => {
    if (unmounting.current || dialogRef.current?.open) return;
    closeRef.current();
  }, []);
  return { dialogRef, onCancel: handleCancel, onClose: handleClose };
}

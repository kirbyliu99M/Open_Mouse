"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { largePhotoPath } from "@/lib/results/mouseMedia";
import {
  RESET_VIEW,
  TAP_MAX_MS,
  TAP_SLOP,
  applyKeyAction,
  clampView,
  distance,
  isDoubleTap,
  midpoint,
  panBy,
  pinchView,
  toggleZoom,
  viewTransform,
  wheelZoom,
  zoomKeyAction,
  type Box,
  type PinchStart,
  type Point,
  type Tap,
  type ZoomView,
} from "@/lib/results/photoZoom";

export interface PhotoZoomCopy {
  /** The button's accessible name, with the mouse named. */
  enlarge: (name: string) => string;
  /** The dialog's close button. */
  close: string;
  /** Screen-reader-only help for the keyboard, read with the dialog. */
  keys: string;
}

/**
 * Click the photo to enlarge it (Kirby, 2026-10-11, candidate). Rendered INSIDE
 * `MousePhoto`'s panel for the one big photo only: a button laid over the whole
 * panel with a corner icon, and, once opened, a native modal `<dialog>` with the
 * photo on the same soft backdrop. The 480 px file already on the page shows at
 * once; the 960 px one is loaded when the dialog opens (or on hover/focus of the
 * button) and swapped in when it has decoded. Zoom 1x to 3x by pinch, wheel,
 * double tap and keys; the maths lives in `@/lib/results/photoZoom`.
 *
 * The dialog is mounted only while open, so a closed page carries no second copy
 * of the name and nothing of the zoom state survives a close (reset to 1x).
 */
export function PhotoZoom({
  imageUrl,
  name,
  copy,
}: {
  imageUrl: string;
  name: string;
  copy: PhotoZoomCopy;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const preloaded = useRef(false);
  const largeUrl = largePhotoPath(imageUrl);

  // Hover or focus on the button is a cheap hint: start fetching the big file.
  const warm = useCallback(() => {
    if (preloaded.current || largeUrl === imageUrl) return;
    preloaded.current = true;
    const img = new Image();
    img.src = largeUrl;
  }, [largeUrl, imageUrl]);

  const handleClosed = useCallback(() => {
    setOpen(false);
    // Native `close()` restores focus itself, but the dialog is unmounted
    // here, so do it explicitly.
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="results-photoZoom-btn"
        aria-haspopup="dialog"
        aria-label={copy.enlarge(name)}
        onClick={() => setOpen(true)}
        onPointerEnter={warm}
        onFocus={warm}
      >
        <span className="results-photoZoom-icon" aria-hidden="true">
          <svg
            viewBox="0 0 20 20"
            width="20"
            height="20"
            focusable="false"
            aria-hidden="true"
          >
            <path d="M12 3h5v5" />
            <path d="M8 17H3v-5" />
            <path d="M17 3l-5.5 5.5" />
            <path d="M3 17l5.5-5.5" />
          </svg>
        </span>
      </button>
      {open && (
        <PhotoDialog
          imageUrl={imageUrl}
          largeUrl={largeUrl}
          name={name}
          copy={copy}
          onClosed={handleClosed}
        />
      )}
    </>
  );
}

function PhotoDialog({
  imageUrl,
  largeUrl,
  name,
  copy,
  onClosed,
}: {
  imageUrl: string;
  largeUrl: string;
  name: string;
  copy: PhotoZoomCopy;
  onClosed: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const captionId = useId();
  const keysId = useId();
  const [src, setSrc] = useState(imageUrl);

  // --- zoom state: refs only, so a gesture never re-renders React ---------
  const view = useRef<ZoomView>({ ...RESET_VIEW });
  const box = useRef<Box>({ width: 1, height: 1 });
  const origin = useRef<Point>({ x: 0, y: 0 }); // box centre on screen
  const frame = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<PinchStart | null>(null);
  const drag = useRef<{ from: Point; view: ZoomView } | null>(null);
  const press = useRef<{ time: number; point: Point; moved: boolean } | null>(
    null,
  );
  const lastTap = useRef<Tap | null>(null);

  const flush = useCallback(() => {
    frame.current = 0;
    const img = imgRef.current;
    const area = areaRef.current;
    if (!img || !area) return;
    img.style.transform = viewTransform(view.current);
    area.dataset.zoomed = view.current.scale > 1.01 ? "true" : "false";
  }, []);

  const commit = useCallback(
    (next: ZoomView) => {
      view.current = next;
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  // Measure the box when the dialog opens and when it resizes: never in a
  // move handler.
  const measure = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    box.current = { width: rect.width || 1, height: rect.height || 1 };
    origin.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    view.current = clampView(view.current, box.current);
  }, []);

  /** Screen point -> box-centre coordinates. */
  const local = useCallback(
    (clientX: number, clientY: number): Point => ({
      x: clientX - origin.current.x,
      y: clientY - origin.current.y,
    }),
    [],
  );

  // Open as a native modal, lock the page behind it, and undo both on close
  // or unmount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    measure();
    const area = areaRef.current;
    let observer: ResizeObserver | null = null;
    if (area && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(area);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      if (frame.current) cancelAnimationFrame(frame.current);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [measure]);

  // The wheel needs a non-passive listener: it must stop the page (and the
  // browser's own ctrl+wheel zoom) from taking the event.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      commit(
        wheelZoom(
          view.current,
          event.deltaY,
          event.deltaMode,
          event.ctrlKey,
          local(event.clientX, event.clientY),
          box.current,
        ),
      );
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [commit, local]);

  // The big file: load and decode off screen, then swap. A failure keeps the
  // small file and says nothing.
  useEffect(() => {
    if (largeUrl === imageUrl) return;
    let cancelled = false;
    const loader = new Image();
    loader.src = largeUrl;
    const ready = () => {
      if (!cancelled) setSrc(largeUrl);
    };
    if (typeof loader.decode === "function") {
      loader.decode().then(ready, () => {
        /* keep the 480 px photo */
      });
    } else {
      loader.onload = ready;
    }
    return () => {
      cancelled = true;
    };
  }, [imageUrl, largeUrl]);

  // --- pointer gestures -----------------------------------------------------
  const startDrag = () => {
    const [only] = [...pointers.current.values()];
    drag.current = only ? { from: only, view: view.current } : null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      press.current = { time: event.timeStamp, point, moved: false };
      startDrag();
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      press.current = null; // a pinch is never a tap
      drag.current = null;
      pinch.current = {
        view: view.current,
        distance: distance(a, b),
        center: local(midpoint(a, b).x, midpoint(a, b).y),
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = midpoint(a, b);
      commit(
        pinchView(
          pinch.current,
          { distance: distance(a, b), center: local(mid.x, mid.y) },
          box.current,
        ),
      );
      return;
    }
    const press1 = press.current;
    if (press1 && distance(press1.point, point) > TAP_SLOP) {
      press1.moved = true;
    }
    if (drag.current && view.current.scale > 1) {
      commit(
        panBy(
          drag.current.view,
          point.x - drag.current.from.x,
          point.y - drag.current.from.y,
          box.current,
        ),
      );
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pinch.current) {
      // One finger left after a pinch carries on as a drag from where it is.
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 1) startDrag();
      return;
    }
    const tap = press.current;
    press.current = null;
    drag.current = null;
    if (
      event.type === "pointerup" &&
      tap &&
      !tap.moved &&
      event.timeStamp - tap.time <= TAP_MAX_MS
    ) {
      const next: Tap = { time: event.timeStamp, point: tap.point };
      if (isDoubleTap(lastTap.current, next)) {
        lastTap.current = null;
        commit(
          toggleZoom(
            view.current,
            local(next.point.x, next.point.y),
            box.current,
          ),
        );
      } else {
        lastTap.current = next;
      }
    }
  };

  // --- keyboard (anywhere in the dialog) ------------------------------------
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    const action = zoomKeyAction(event, view.current.scale > 1.01);
    if (!action) return;
    event.preventDefault();
    commit(applyKeyAction(view.current, action, box.current));
  };

  return (
    // The dialog fills the screen; a press on the dialog itself (not on one of
    // its children) is a press on the scrim.
    <dialog
      ref={dialogRef}
      className="results-photoDialog"
      aria-labelledby={captionId}
      aria-describedby={keysId}
      onClose={onClosed}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <p id={captionId} className="results-photoDialog-caption">
        {name}
      </p>
      <p id={keysId} className="results-visuallyHidden">
        {copy.keys}
      </p>
      <button
        type="button"
        className="results-photoDialog-close"
        aria-label={copy.close}
        onClick={() => dialogRef.current?.close()}
      >
        <svg
          viewBox="0 0 20 20"
          width="20"
          height="20"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M5 5l10 10" />
          <path d="M15 5L5 15" />
        </svg>
      </button>
      <div
        ref={areaRef}
        className="results-photoDialog-area"
        data-zoomed="false"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDragStart={(event) => event.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a plain site-relative file, transformed by the zoom */}
        <img
          ref={imgRef}
          src={src}
          alt={name}
          className="results-photoDialog-img"
          draggable={false}
          decoding="async"
        />
      </div>
    </dialog>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  closeSheet,
  editDraft,
  emptyFilters,
  isFiltering,
  matchCount,
  openSheet,
  type Filters,
} from "@/lib/results/filters";
import { FilterFacets } from "./FilterFacets";
import { FilterStatus } from "./FilterStatus";
import { prefersReducedMotion } from "./useWideLayout";
import "./filter.css";

/** How long the slide-down takes; also the longest the close waits for it. */
const CLOSE_MS = 240;
/** Past this share of the sheet's height, or this speed (px per ms), letting go closes it. */
const DRAG_CLOSE_SHARE = 0.3;
const DRAG_CLOSE_SPEED = 0.6;

/**
 * The phone's filter: a bottom sheet over a dimmed results page, a native
 * `<dialog>` opened with `showModal()` (so focus stays inside, and the page
 * behind is inert). Mount it to open it; `onClosed` says it is done and the
 * parent unmounts it and puts focus back on 「篩選（n）」.
 *
 * It edits a draft: 「查看 N 款滑鼠」 applies it (`onApply`); ✕, Esc, a tap on
 * the dim area and dragging the handle down throw it away. Dragging has the
 * visible ✕ as its alternative, and with reduced motion nothing slides.
 * Focus goes to the title on open.
 */
export function FilterSheet({
  response,
  language,
  applied,
  onApply,
  onClosed,
}: {
  response: FitResponse;
  language: UiLanguage;
  applied: Filters;
  onApply: (filters: Filters) => void;
  onClosed: () => void;
}) {
  const copy = RESULTS_PAGE_COPY[language].filter;
  const lang = uiLangAttribute(language);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState(() => openSheet(applied));
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const draftCount = matchCount(response, state.draft);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const finish = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClosed();
  }, [onClosed]);

  /** Close with the slide-down (at once with reduced motion). */
  const requestClose = useCallback(
    (apply: boolean) => {
      if (closing.current) return;
      closing.current = true;
      if (apply) onApply(closeSheet(state, true));
      if (prefersReducedMotion()) {
        finish();
        return;
      }
      setLeaving(true);
      window.setTimeout(finish, CLOSE_MS);
    },
    [finish, onApply, state],
  );

  // ---- Dragging the handle down
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
    e.currentTarget.setPointerCapture(e.pointerId);
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
    const speed = d.dy / Math.max(1, e.timeStamp - d.startT);
    const leave =
      !cancelled &&
      (d.dy > height * DRAG_CLOSE_SHARE ||
        (d.dy > 24 && speed > DRAG_CLOSE_SPEED));
    sheet.style.transition = "";
    if (leave) {
      // Carry on down from where the finger let go.
      sheet.style.transform = "translateY(100%)";
      requestClose(false);
    } else {
      // Back up from where the finger let go: the transition runs from the
      // current offset, so the sheet can be grabbed again at any point.
      sheet.style.transform = "";
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="results-sheet"
      data-leaving={leaving ? "true" : undefined}
      aria-labelledby={titleId}
      lang={lang}
      onCancel={(e) => {
        // Esc: slide down and discard, rather than the browser's instant close.
        e.preventDefault();
        requestClose(false);
      }}
      onClose={() => {
        // Closed some other way (not through requestClose): still tell the parent.
        if (!closing.current) {
          closing.current = true;
          onClosed();
        }
      }}
      onClick={(e) => {
        // A tap on the dimmed area (the dialog itself, outside its box) discards.
        if (e.target === e.currentTarget) requestClose(false);
      }}
    >
      <div className="results-sheet-panel">
        <div
          className="results-sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
        >
          <span className="results-sheet-handle" aria-hidden="true" />
          <div className="results-sheet-head">
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="results-sheet-title"
            >
              {copy.title}
            </h2>
            <button
              type="button"
              className="results-sheet-close"
              aria-label={copy.closeSheet}
              onClick={() => requestClose(false)}
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
        </div>
        <div className="results-sheet-body">
          <FilterFacets
            response={response}
            language={language}
            filters={state.draft}
            onChange={(draft) => setState((s) => editDraft(s, draft))}
          />
        </div>
        <div className="results-sheet-foot">
          <button
            type="button"
            className="results-textLink"
            aria-disabled={isFiltering(state.draft) ? undefined : "true"}
            onClick={() => {
              if (!isFiltering(state.draft)) return;
              setState((s) => editDraft(s, emptyFilters()));
            }}
          >
            {copy.clearAll}
          </button>
          <button
            type="button"
            className="results-pill"
            onClick={() => requestClose(true)}
          >
            {copy.viewButton(draftCount)}
          </button>
        </div>
        {/* The page's own status region is outside a modal dialog, so the
            sheet carries the (single) one while it is open. */}
        <FilterStatus count={draftCount} language={language} />
      </div>
    </dialog>
  );
}

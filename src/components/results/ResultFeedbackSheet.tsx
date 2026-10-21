"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Locale } from "@/lib/contracts/locale";
import type { ResultsEmit } from "@/lib/results/analyticsEvents";
import {
  RESULT_FEEDBACK_AUTOCLOSE_MS,
  RESULT_FEEDBACK_TICK_MS,
  addVisibleTime,
  canPageScroll,
  dismissedEventDue,
  dragClosesSheet,
  escapeCloses,
  fetchAnswered,
  markFeedbackDone,
  reachedEnd,
  feedbackSender,
  markPromptShown,
  promptCoolingDown,
  readFeedbackDone,
  readLastPrompt,
  submitFeedback,
  shouldShowSheet,
  shownEvent,
  type SendFailure,
  type SheetPhase,
} from "@/lib/results/resultFeedback";
import { fetchReminderStatus } from "@/lib/results/surveyReminder";
import { ResultFeedbackPanel } from "./ResultFeedbackPanel";
import { resultFeedbackCopy } from "@/lib/copy/result-feedback";

/**
 * The feedback sheet of the results page (v2, Kirby 2026-10-15): a bottom
 * sheet on a phone and a floating card on a desktop that does not block the
 * page (no backdrop, no focus trap) and is announced politely. It appears
 * after `RESULT_FEEDBACK_MIN_DWELL_MS` of the tab being visible once the end of
 * the list has been scrolled into view or Details was opened, or after
 * `RESULT_FEEDBACK_DWELL_MS` once the person has scrolled (or the page cannot
 * scroll), and only if `GET` says the scan was not rated, this device has not
 * closed it, this device was not prompted in the last 30 days and the
 * questionnaire is not answered (V3.2 F11, candidate). The rules are in
 * `src/lib/results/resultFeedback.ts`; what is drawn is in
 * `ResultFeedbackPanel`. Closing (X, Esc, or pulling the handle down) means
 * this device is not asked again for this scan. Renders an invisible marker
 * for the end of the list; mount it after the last block.
 */
export function ResultFeedbackSheet({
  scanId,
  language,
  emit,
  resultFingerprint,
  onResultChanged,
  openedDetails = false,
}: {
  scanId: string;
  language: Locale;
  /** The results page's emitter (real pages only); it adds the page fields. */
  emit?: ResultsEmit;
  /**
   * V3.2 F1 (candidate): the fingerprint of the ranking on screen, sent with
   * the rating. Absent: no header (the server behaves as before).
   */
  resultFingerprint?: string;
  /**
   * Called when the server answers 412 (the ranking changed): the page fetches
   * the new ranking. The sheet keeps the stars and the comment, says why, and
   * waits for the person to send again; it never sends by itself.
   */
  onResultChanged?: () => void;
  /** The person opened the Details section of the first place (V3.2 F11). */
  openedDetails?: boolean;
}) {
  const copy = resultFeedbackCopy(language);
  const markerRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const shownSent = useRef(false);

  const [answered, setAnswered] = useState<boolean | null>(null);
  const [localDone, setLocalDone] = useState(false);
  // V3.2 F11: until this device's memory is read it counts as cooling down,
  // and the questionnaire as unanswered only once it is known.
  const [coolingDown, setCoolingDown] = useState(true);
  const [questionnaireAnswered, setQuestionnaireAnswered] = useState(false);
  const [markerInView, setMarkerInView] = useState(false);
  const [scrollMovedPx, setScrollMovedPx] = useState(0);
  const [hasScrolled, setHasScrolled] = useState(false);
  // Until it is measured the page is assumed to scroll, so the timer waits.
  const [canScroll, setCanScroll] = useState(true);
  const [visibleMs, setVisibleMs] = useState(0);
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<SheetPhase>("form");
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);

  // This device's memory and the server's status, asked once. A device that
  // is cooling down asks nothing (V3.2 F11).
  useEffect(() => {
    if (readFeedbackDone(scanId)) {
      setLocalDone(true);
      return;
    }
    if (promptCoolingDown(readLastPrompt(), Date.now())) return;
    setCoolingDown(false);
    const controller = new AbortController();
    void fetchAnswered(scanId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setAnswered(next);
    });
    void fetchReminderStatus(controller.signal).then((status) => {
      if (!controller.signal.aborted)
        setQuestionnaireAnswered(status === "answered");
    });
    return () => controller.abort();
  }, [scanId]);

  // The visible-time clock: a tick counts only while the tab is visible, and
  // each tick re-measures whether the page can scroll (the list may load late).
  const clockRunning = !opened && !localDone && !coolingDown;
  useEffect(() => {
    if (!clockRunning) return;
    const measure = () =>
      setCanScroll(
        canPageScroll({
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
        }),
      );
    measure();
    const timer = window.setInterval(() => {
      setVisibleMs((ms) =>
        addVisibleTime(
          ms,
          RESULT_FEEDBACK_TICK_MS,
          document.visibilityState === "visible",
        ),
      );
      measure();
    }, RESULT_FEEDBACK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [clockRunning]);

  // Whether the person really scrolled, and whether the end of the list has
  // been reached: in view, or already scrolled past (a jump to the bottom, or a
  // footer taller than the window, never shows the marker to an observer). The
  // marker already in view on load does not count: a real scroll is needed.
  useEffect(() => {
    const startY = window.scrollY;
    const onScroll = () => {
      const moved = Math.max(0, Math.abs(window.scrollY - startY));
      setScrollMovedPx(moved);
      // Sticky: scrolling back to where it started is still a scroll.
      if (moved > 0) setHasScrolled(true);
      const marker = markerRef.current;
      if (marker) {
        setMarkerInView(
          marker.getBoundingClientRect().top <= window.innerHeight,
        );
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const scrolledToEnd = reachedEnd({ markerInView, scrollMovedPx });

  const show = shouldShowSheet({
    answered,
    dismissedLocally: localDone,
    scrolledToEnd,
    visibleElapsedMs: visibleMs,
    hasScrolled,
    canScroll,
    isDemo: false,
    openedDetails,
    coolingDown,
    questionnaireAnswered,
  });
  // Once shown it stays until closed.
  useEffect(() => {
    if (!show) return;
    setOpened(true);
    if (shownSent.current) return;
    shownSent.current = true;
    // One prompt per device per cool-down, whatever the scan (V3.2 F11).
    markPromptShown(Date.now());
    const event = shownEvent(scrolledToEnd);
    emit?.(event.name, event.props);
    // `scrolledToEnd` is read at the moment the sheet first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const visible = opened && !localDone;

  // Room at the very bottom of the page (after the footer), as tall as the
  // sheet and its gap to the window edge, so the footer and the share button
  // can be scrolled above the sheet. `results.css` turns the variable into the
  // body's bottom padding.
  useEffect(() => {
    const sheet = sheetRef.current;
    const section = sectionRef.current;
    if (!visible || !sheet || !section) return;
    const root = document.documentElement;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(section).bottom) || 0;
      root.style.setProperty(
        "--feedback-room",
        `${sheet.offsetHeight + gap}px`,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(sheet);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      root.style.removeProperty("--feedback-room");
    };
  }, [visible]);

  // The data note opens in place: bring it into view in the scrolling panel.
  useEffect(() => {
    if (!notesOpen) return;
    const section = sectionRef.current;
    const notes = section?.querySelector<HTMLElement>(
      ".results-feedback-notes",
    );
    if (!notes) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    notes.scrollIntoView({
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [notesOpen]);

  /** After the sheet goes away, focus must not fall to the body. */
  const rescueFocus = useCallback(() => {
    const section = sectionRef.current;
    if (!section || !section.contains(document.activeElement)) return;
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    rescueFocus();
    markFeedbackDone(scanId);
    setLocalDone(true);
  }, [scanId, rescueFocus]);

  // The X, Esc and the handle: "dismissed" only while nothing was sent.
  const dismiss = () => {
    if (phase === "sending") return;
    if (dismissedEventDue(phase)) emit?.("result_feedback_dismissed", {});
    close();
  };

  // The wiring is `submitFeedback` (tested in result-fingerprint.test.ts):
  // only the button calls it, so the sheet never sends by itself, also not
  // when a new ranking (a new `resultFingerprint`) arrives after a 412.
  const submit = () =>
    submitFeedback(
      {
        scanId,
        phase,
        stars,
        comment,
        locale: language,
        resultFingerprint,
      },
      {
        send: feedbackSender(),
        markDone: (id) => markFeedbackDone(id),
        setFailure,
        setPhase,
        emitSubmitted: (event) => emit?.(event.name, event.props),
        onResultChanged,
      },
    );

  // Thanks closes itself. After "thanks" or "already sent" the submit button
  // is gone: if the focus was on it (now the body), keep it inside the sheet,
  // on the X after thanks and on the done button after "already", so Escape
  // and the keyboard keep working.
  useEffect(() => {
    if (phase !== "thanks" && phase !== "already") return;
    const section = sectionRef.current;
    if (section && document.activeElement === document.body) {
      section
        .querySelector<HTMLElement>(
          phase === "already"
            ? ".results-feedback-primary"
            : ".results-feedback-close",
        )
        ?.focus({ preventScroll: true });
    }
    if (phase !== "thanks") return;
    const timer = window.setTimeout(close, RESULT_FEEDBACK_AUTOCLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, close]);

  // The handle: pull down more than 64 px and let go to close. A phone only
  // (the handle is hidden on a desktop). With reduced motion the sheet does not
  // follow the finger; the pull is judged when it is released.
  const drag = useRef<{ id: number; startY: number; dy: number } | null>(null);
  const resetSheet = () => {
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transition = "";
      sheet.style.transform = "";
    }
  };
  const handleHandlers: HTMLAttributes<HTMLDivElement> = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (phase === "sending") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, startY: event.clientY, dy: 0 };
      const sheet = sheetRef.current;
      if (sheet) sheet.style.transition = "none";
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.dy = Math.max(0, event.clientY - current.startY);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const sheet = sheetRef.current;
      if (sheet && !reduced)
        sheet.style.transform = `translateY(${current.dy}px)`;
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null;
      if (dragClosesSheet(current.dy)) dismiss();
      else resetSheet();
    },
    onPointerCancel: () => {
      drag.current = null;
      resetSheet();
    },
  };

  const announcement = !visible
    ? ""
    : phase === "thanks"
      ? copy.done
      : phase === "already"
        ? copy.already
        : copy.title;

  return (
    <>
      <div
        ref={markerRef}
        className="results-feedback-marker"
        aria-hidden="true"
      />
      {/* Always in the page, so the text added to it is announced. */}
      <p className="results-srOnly" role="status" aria-live="polite">
        {announcement}
      </p>
      {/* In the body, not in the page: the results view isolates its own
          stacking context, and the site footer (later in the page) would paint
          over a sheet that lives inside it. */}
      {visible &&
        createPortal(
          <ResultFeedbackPanel
            language={language}
            phase={phase}
            stars={stars}
            comment={comment}
            notesOpen={notesOpen}
            failure={failure}
            sectionRef={sectionRef}
            sheetRef={sheetRef}
            handleHandlers={handleHandlers}
            onStars={(n) => {
              setStars(n);
              // A new star starts over: the last failure was about the old one.
              setFailure(null);
            }}
            onComment={setComment}
            onToggleNotes={() => setNotesOpen((open) => !open)}
            onSubmit={() => void submit()}
            onClose={dismiss}
            onEscape={(composing) => {
              if (!escapeCloses({ phase, composing, comment })) return;
              dismiss();
            }}
          />,
          document.body,
        )}
    </>
  );
}
